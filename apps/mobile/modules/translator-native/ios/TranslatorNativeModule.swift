import ExpoModulesCore
import ImageIO
import PDFKit
import UIKit
import Vision

#if !targetEnvironment(simulator)
import MLKitLanguageID
import MLKitTranslate
#endif

/// On-device translation (Google ML Kit), language identification (ML Kit) and text
/// recognition (Apple Vision, which also reads Arabic). Nothing here uses the network
/// except the one-time language model downloads, which come from Google.
///
/// Errors reach JavaScript with a stable `code` (the same codes as on Android, see
/// `TranslatorError`), so the app can show a localized message.
public class TranslatorNativeModule: Module {
  #if !targetEnvironment(simulator)
  /// Guards `translators` and `downloads`: ML Kit calls back on threads of its choosing.
  private let lock = NSLock()
  private var translators: [String: Translator] = [:]
  private var downloads: [ObjectIdentifier: ModelDownload] = [:]

  private func locked<T>(_ body: () throws -> T) rethrows -> T {
    lock.lock()
    defer { lock.unlock() }
    return try body()
  }
  #endif

  public func definition() -> ModuleDefinition {
    Name("TranslatorNative")

    Events("onDownloadProgress")

    Function("isTranslationAvailable") { () -> Bool in
      #if targetEnvironment(simulator)
      return false
      #else
      return true
      #endif
    }

    Function("isTextRecognitionAvailable") { () -> Bool in
      return true
    }

    Function("supportedRecognitionLanguages") { () -> [String] in
      return Self.visionLanguages
    }

    // URL schemes this build registered (CFBundleURLTypes). Google Sign-In aborts the app
    // when its reversed client ID is missing here, so JavaScript checks before offering it.
    Function("urlSchemes") { () -> [String] in
      let types = Bundle.main.object(forInfoDictionaryKey: "CFBundleURLTypes") as? [[String: Any]] ?? []
      return types.flatMap { $0["CFBundleURLSchemes"] as? [String] ?? [] }
    }

    AsyncFunction("translate") { (text: String, source: String, target: String) async throws -> String in
      #if targetEnvironment(simulator)
      throw TranslatorError.unavailable()
      #else
      return try await self.translate(text: text, source: source, target: target)
      #endif
    }

    AsyncFunction("downloadModel") { (language: String, wifiOnly: Bool) async throws in
      #if targetEnvironment(simulator)
      throw TranslatorError.unavailable()
      #else
      try await self.download(language: language, wifiOnly: wifiOnly)
      #endif
    }

    AsyncFunction("deleteModel") { (language: String) async throws in
      #if targetEnvironment(simulator)
      throw TranslatorError.unavailable()
      #else
      try Self.requireSupported(language)
      let model = TranslateRemoteModel.translateRemoteModel(language: TranslateLanguage(rawValue: language))
      let _: Void = try await awaitCallback { done in
        ModelManager.modelManager().deleteDownloadedModel(model) { error in
          if let error {
            done(.failure(TranslatorError.make("DELETE_FAILED", language, cause: error)))
          } else {
            done(.success(()))
          }
        }
      }
      self.locked { self.translators = self.translators.filter { !Self.pair($0.key, uses: language) } }
      #endif
    }

    AsyncFunction("getDownloadedModels") { () -> [String] in
      #if targetEnvironment(simulator)
      return []
      #else
      return ModelManager.modelManager().downloadedTranslateModels.map { $0.language.rawValue }
      #endif
    }

    AsyncFunction("identifyLanguage") { (text: String) async -> String in
      #if targetEnvironment(simulator)
      return "und"
      #else
      let identifier = LanguageIdentification.languageIdentification()
      // Unsure and failed both mean "und", as on Android.
      let code: String = (try? await awaitCallback { done in
        identifier.identifyLanguage(for: text) { code, error in
          done(.success(error == nil ? (code ?? "und") : "und"))
        }
      }) ?? "und"
      return code
      #endif
    }

    AsyncFunction("recognizeText") { (uri: String, languages: [String]) async throws -> [String: Any] in
      return try await Self.recognize(uri: uri, languages: languages)
    }

    // Text of each page of a PDF. Pages without a text layer (scans) are read with Vision.
    AsyncFunction("extractPdfText") { (uri: String, languages: [String], maxPages: Int) async throws -> [String: Any] in
      return try await Self.extractPdf(uri: uri, languages: languages, maxPages: maxPages)
    }

    OnDestroy {
      #if !targetEnvironment(simulator)
      // ML Kit keeps downloading in the background; only this module's listeners go away.
      let pending: [ModelDownload] = self.locked {
        let all = Array(self.downloads.values)
        self.downloads.removeAll()
        return all
      }
      pending.forEach { $0.finish(TranslatorError.downloadFailed($0.language)) }
      #endif
    }
  }

  // MARK: - Translation

  #if !targetEnvironment(simulator)
  private static let translateLanguages = Set(TranslateLanguage.allLanguages().map(\.rawValue))

  /// ML Kit expects codes from its own list; reject anything else before it reaches ML Kit.
  private static func requireSupported(_ languages: String...) throws {
    if let unsupported = languages.first(where: { !translateLanguages.contains($0) }) {
      throw TranslatorError.make("UNSUPPORTED_LANGUAGE", unsupported)
    }
  }

  /// Whether a cached translator key such as "ar>en" involves `language`.
  private static func pair(_ key: String, uses language: String) -> Bool {
    return key.split(separator: ">").contains { $0 == language }
  }

  private func translate(text: String, source: String, target: String) async throws -> String {
    try Self.requireSupported(source, target)
    let manager = ModelManager.modelManager()
    for lang in [source, target] {
      let model = TranslateRemoteModel.translateRemoteModel(language: TranslateLanguage(rawValue: lang))
      if !manager.isModelDownloaded(model) { throw TranslatorError.make("MODEL_MISSING", lang) }
    }
    let key = "\(source)>\(target)"
    let translator: Translator = locked {
      if let cached = translators[key] { return cached }
      let options = TranslatorOptions(sourceLanguage: TranslateLanguage(rawValue: source), targetLanguage: TranslateLanguage(rawValue: target))
      let created = Translator.translator(options: options)
      translators[key] = created
      return created
    }
    return try await awaitCallback { done in
      translator.translate(text) { result, error in
        if let error {
          done(.failure(TranslatorError.make("TRANSLATE_FAILED", cause: error)))
        } else {
          done(.success(result ?? ""))
        }
      }
    }
  }

  private func download(language: String, wifiOnly: Bool) async throws {
    try Self.requireSupported(language)
    let model = TranslateRemoteModel.translateRemoteModel(language: TranslateLanguage(rawValue: language))
    let manager = ModelManager.modelManager()
    if manager.isModelDownloaded(model) { return }
    // Foreground transfer: iOS may postpone background downloads (mobile data, Low Power Mode),
    // which left the download waiting with no progress while the user watched the screen.
    let conditions = ModelDownloadConditions(allowsCellularAccess: !wifiOnly, allowsBackgroundDownloading: false)

    try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
      let job = ModelDownload(language: language, continuation: c)
      let id = ObjectIdentifier(job)
      locked { downloads[id] = job }

      let end: (Error?) -> Void = { [weak self] error in
        if let self {
          self.locked { _ = self.downloads.removeValue(forKey: id) }
          if error == nil { self.sendEvent("onDownloadProgress", ["language": language, "progress": 1.0]) }
        }
        job.finish(error)
      }
      let matches: (Notification) -> Bool = { note in
        let m = note.userInfo?[ModelDownloadUserInfoKey.remoteModel.rawValue] as? TranslateRemoteModel
        return m?.language.rawValue == language
      }
      // Observers go in before the download starts, so no completion can be missed.
      job.keep(token: NotificationCenter.default.addObserver(forName: .mlkitModelDownloadDidSucceed, object: nil, queue: nil) { note in
        if matches(note) { end(nil) }
      })
      job.keep(token: NotificationCenter.default.addObserver(forName: .mlkitModelDownloadDidFail, object: nil, queue: nil) { note in
        if matches(note) {
          let cause = note.userInfo?[ModelDownloadUserInfoKey.error.rawValue] as? Error
          end(TranslatorError.downloadFailed(language, cause: cause))
        }
      })
      let progress = manager.download(model, conditions: conditions)
      job.keep(observation: progress.observe(\.fractionCompleted) { [weak self] p, _ in
        let value = p.fractionCompleted
        if job.shouldReport(value) {
          self?.sendEvent("onDownloadProgress", ["language": language, "progress": value])
        }
      })
      // A download that finished in the meantime (another request for the same language)
      // may never post a notification for this one.
      if manager.isModelDownloaded(model) { end(nil) }
    }
  }
  #endif

  // MARK: - Text recognition (Apple Vision)

  private static let visionLanguages: [String] = {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    return (try? request.supportedRecognitionLanguages()) ?? []
  }()

  private static func fileURL(_ uri: String) -> URL {
    if uri.hasPrefix("file://"), let url = URL(string: uri) { return url }
    return URL(fileURLWithPath: uri.hasPrefix("file://") ? String(uri.dropFirst(7)) : uri)
  }

  private static func extractPdf(uri: String, languages: [String], maxPages: Int) async throws -> [String: Any] {
    guard let document = PDFDocument(url: fileURL(uri)) else { throw TranslatorError.make("BAD_PDF") }
    if document.isLocked { throw TranslatorError.make("LOCKED_PDF") }
    let count = min(document.pageCount, max(1, maxPages))
    var pages: [String] = []
    var scanned = 0
    for index in 0..<count {
      guard let page = document.page(at: index) else { pages.append(""); continue }
      let text = page.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      if text.count > 20 {
        pages.append(text)
        continue
      }
      // Scanned page: render it and read it with Vision. The pool frees each rendered page
      // before the next one, so a long scan does not pile up images.
      let cgImage: CGImage? = autoreleasepool { render(page) }
      guard let cgImage else { pages.append(""); continue }
      // One unreadable page should not lose the rest of the document.
      let result = try? await recognize(cgImage: cgImage, orientation: .up, languages: languages)
      pages.append(result?["text"] as? String ?? text)
      if result != nil { scanned += 1 }
    }
    return ["pages": pages, "pageCount": document.pageCount, "scannedPages": scanned]
  }

  /// About 144 dpi, with the longest side capped so a poster-sized page cannot exhaust memory.
  private static func render(_ page: PDFPage) -> CGImage? {
    let bounds = page.bounds(for: .mediaBox)
    let longest = max(bounds.width, bounds.height)
    guard longest > 0, longest.isFinite else { return nil }
    let scale = min(2, 2200 / longest)
    let size = CGSize(width: max(1, bounds.width * scale), height: max(1, bounds.height * scale))
    return page.thumbnail(of: size, for: .mediaBox).cgImage
  }

  private static func recognize(uri: String, languages: [String]) async throws -> [String: Any] {
    // ImageIO decodes an upright copy capped at 4096 px: a full-size 48 MP photo would need
    // about 190 MB. Smaller images keep their size.
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceShouldCacheImmediately: true,
      kCGImageSourceThumbnailMaxPixelSize: 4096,
    ]
    guard let source = CGImageSourceCreateWithURL(fileURL(uri) as CFURL, nil),
          let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    else {
      throw TranslatorError.make("BAD_IMAGE")
    }
    return try await recognize(cgImage: cgImage, orientation: .up, languages: languages)
  }

  private static func recognize(cgImage: CGImage, orientation: CGImagePropertyOrientation, languages: [String]) async throws -> [String: Any] {
    let supported = visionLanguages
    // Match "ar" to "ar-SA", "zh" to "zh-Hans" and so on.
    let wanted = languages.flatMap { code in supported.filter { $0 == code || $0.hasPrefix(code + "-") } }

    // No completion handler: Vision can call it with an error and also throw from perform(_:),
    // which resumed the continuation twice and crashed. perform(_:) is synchronous, so each
    // path below resumes exactly once.
    return try await withCheckedThrowingContinuation { c in
      DispatchQueue.global(qos: .userInitiated).async {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        if wanted.isEmpty {
          request.automaticallyDetectsLanguage = true
        } else {
          request.recognitionLanguages = wanted
        }
        do {
          try VNImageRequestHandler(cgImage: cgImage, orientation: orientation).perform([request])
        } catch {
          c.resume(throwing: TranslatorError.make("OCR_FAILED", cause: error))
          return
        }
        var blocks: [[String: Any]] = []
        var lines: [String] = []
        for o in request.results ?? [] {
          guard let best = o.topCandidates(1).first else { continue }
          lines.append(best.string)
          let b = o.boundingBox
          blocks.append([
            "text": best.string,
            "frame": ["x": b.minX, "y": 1 - b.maxY, "width": b.width, "height": b.height],
          ])
        }
        c.resume(returning: ["text": lines.joined(separator: "\n"), "blocks": blocks])
      }
    }
  }
}

// MARK: - Helpers

/// Resumes a continuation at most once. ML Kit calls back on threads of its choosing, and a
/// checked continuation resumed twice terminates the app, so only the first result counts.
private final class ResumeOnce<T>: @unchecked Sendable {
  private let lock = NSLock()
  private var continuation: CheckedContinuation<T, Error>?

  init(_ continuation: CheckedContinuation<T, Error>) {
    self.continuation = continuation
  }

  func resume(with result: Result<T, Error>) {
    lock.lock()
    let c = continuation
    continuation = nil
    lock.unlock()
    c?.resume(with: result)
  }
}

/// Bridges a completion-handler API to async/await, resuming exactly once.
private func awaitCallback<T>(_ start: (@escaping (Result<T, Error>) -> Void) -> Void) async throws -> T {
  return try await withCheckedThrowingContinuation { (c: CheckedContinuation<T, Error>) in
    let once = ResumeOnce(c)
    start { once.resume(with: $0) }
  }
}

#if !targetEnvironment(simulator)
/// One model download. ML Kit posts progress and completion on threads of its choosing, so
/// all state is guarded by `lock` and the continuation is resumed exactly once.
private final class ModelDownload: @unchecked Sendable {
  let language: String
  private let lock = NSLock()
  private var continuation: CheckedContinuation<Void, Error>?
  private var tokens: [NSObjectProtocol] = []
  private var observation: NSKeyValueObservation?
  private var lastReported = -1.0

  init(language: String, continuation: CheckedContinuation<Void, Error>) {
    self.language = language
    self.continuation = continuation
  }

  /// Holds a notification observer until the download ends (or drops it if it already has).
  func keep(token: NSObjectProtocol) {
    lock.lock()
    let ended = continuation == nil
    if !ended { tokens.append(token) }
    lock.unlock()
    if ended { NotificationCenter.default.removeObserver(token) }
  }

  func keep(observation: NSKeyValueObservation) {
    lock.lock()
    let ended = continuation == nil
    if !ended { self.observation = observation }
    lock.unlock()
    if ended { observation.invalidate() }
  }

  /// Progress fires for every chunk; one event per percent is plenty for the UI.
  func shouldReport(_ progress: Double) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    guard continuation != nil, progress - lastReported >= 0.01 || (progress >= 1 && lastReported < 1) else { return false }
    lastReported = progress
    return true
  }

  func finish(_ error: Error?) {
    lock.lock()
    let c = continuation
    let tokens = self.tokens
    let observation = self.observation
    continuation = nil
    self.tokens = []
    self.observation = nil
    lock.unlock()

    guard let c else { return }
    tokens.forEach { NotificationCenter.default.removeObserver($0) }
    observation?.invalidate()
    if let error { c.resume(throwing: error) } else { c.resume() }
  }
}
#endif

/// Errors with a stable `code` for JavaScript; Android rejects with the same codes. The
/// message keeps the "CODE:detail" form (e.g. "MODEL_MISSING:ar") so the detail survives.
/// Codes: ON_DEVICE_UNAVAILABLE, UNSUPPORTED_LANGUAGE, MODEL_MISSING, TRANSLATE_FAILED,
/// DOWNLOAD_FAILED, DELETE_FAILED, BAD_IMAGE, OCR_FAILED, BAD_PDF, LOCKED_PDF.
enum TranslatorError {
  static func make(_ code: String, _ detail: String? = nil, cause: Error? = nil) -> Exception {
    let message = detail.map { "\(code):\($0)" } ?? code
    return Exception(name: "TranslatorError", description: message, code: code).causedBy(cause)
  }

  static func unavailable() -> Exception {
    return make("ON_DEVICE_UNAVAILABLE")
  }

  static func downloadFailed(_ language: String, cause: Error? = nil) -> Exception {
    return make("DOWNLOAD_FAILED", language, cause: cause)
  }
}
