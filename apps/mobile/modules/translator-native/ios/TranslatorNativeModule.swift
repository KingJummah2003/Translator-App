import ExpoModulesCore
import UIKit
import Vision

#if !targetEnvironment(simulator)
import MLKitLanguageID
import MLKitTranslate
#endif

/// On-device translation (Google ML Kit), language identification (ML Kit) and text
/// recognition (Apple Vision, which also reads Arabic). Nothing here uses the network
/// except the one-time language model downloads, which come from Google.
public class TranslatorNativeModule: Module {
  #if !targetEnvironment(simulator)
  private let lock = NSLock()
  private var translators: [String: Translator] = [:]
  private var observers: [NSObjectProtocol] = []
  private var progressObservations: [String: NSKeyValueObservation] = [:]
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
      return Self.visionLanguages()
    }

    AsyncFunction("translate") { (text: String, source: String, target: String) async throws -> String in
      #if targetEnvironment(simulator)
      throw TranslatorError.unavailable
      #else
      return try await self.translate(text: text, source: source, target: target)
      #endif
    }

    AsyncFunction("downloadModel") { (language: String, wifiOnly: Bool) async throws in
      #if targetEnvironment(simulator)
      throw TranslatorError.unavailable
      #else
      try await self.download(language: language, wifiOnly: wifiOnly)
      #endif
    }

    AsyncFunction("deleteModel") { (language: String) async throws in
      #if targetEnvironment(simulator)
      throw TranslatorError.unavailable
      #else
      let model = TranslateRemoteModel.translateRemoteModel(language: TranslateLanguage(rawValue: language))
      try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
        ModelManager.modelManager().deleteDownloadedModel(model) { error in
          if let error { c.resume(throwing: error) } else { c.resume() }
        }
      }
      self.lock.withLock { self.translators = self.translators.filter { !$0.key.contains(language) } }
      #endif
    }

    AsyncFunction("getDownloadedModels") { () -> [String] in
      #if targetEnvironment(simulator)
      return []
      #else
      return ModelManager.modelManager().downloadedTranslateModels.map { $0.language.rawValue }
      #endif
    }

    AsyncFunction("identifyLanguage") { (text: String) async throws -> String in
      #if targetEnvironment(simulator)
      return "und"
      #else
      let identifier = LanguageIdentification.languageIdentification()
      return try await withCheckedThrowingContinuation { c in
        identifier.identifyLanguage(for: text) { code, error in
          if let error { c.resume(throwing: error) } else { c.resume(returning: code ?? "und") }
        }
      }
      #endif
    }

    AsyncFunction("recognizeText") { (uri: String, languages: [String]) async throws -> [String: Any] in
      return try await Self.recognize(uri: uri, languages: languages)
    }

    OnDestroy {
      #if !targetEnvironment(simulator)
      self.observers.forEach { NotificationCenter.default.removeObserver($0) }
      self.progressObservations.removeAll()
      #endif
    }
  }

  // MARK: - Translation

  #if !targetEnvironment(simulator)
  private func translate(text: String, source: String, target: String) async throws -> String {
    let manager = ModelManager.modelManager()
    for lang in [source, target] {
      let model = TranslateRemoteModel.translateRemoteModel(language: TranslateLanguage(rawValue: lang))
      if !manager.isModelDownloaded(model) { throw TranslatorError.modelMissing(lang) }
    }
    let key = "\(source)>\(target)"
    let translator: Translator = lock.withLock {
      if let cached = translators[key] { return cached }
      let options = TranslatorOptions(sourceLanguage: TranslateLanguage(rawValue: source), targetLanguage: TranslateLanguage(rawValue: target))
      let created = Translator.translator(options: options)
      translators[key] = created
      return created
    }
    return try await withCheckedThrowingContinuation { c in
      translator.translate(text) { result, error in
        if let error { c.resume(throwing: error) } else { c.resume(returning: result ?? "") }
      }
    }
  }

  private func download(language: String, wifiOnly: Bool) async throws {
    let model = TranslateRemoteModel.translateRemoteModel(language: TranslateLanguage(rawValue: language))
    let manager = ModelManager.modelManager()
    if manager.isModelDownloaded(model) { return }
    let conditions = ModelDownloadConditions(allowsCellularAccess: !wifiOnly, allowsBackgroundDownloading: true)

    try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
      var finished = false
      var tokens: [NSObjectProtocol] = []
      let finish: (Error?) -> Void = { [weak self] error in
        guard !finished else { return }
        finished = true
        tokens.forEach { NotificationCenter.default.removeObserver($0) }
        self?.progressObservations[language] = nil
        if let error { c.resume(throwing: error) } else { c.resume() }
      }
      let matches: (Notification) -> Bool = { note in
        let m = note.userInfo?[ModelDownloadUserInfoKey.remoteModel.rawValue] as? TranslateRemoteModel
        return m?.language.rawValue == language
      }
      tokens.append(NotificationCenter.default.addObserver(forName: .mlkitModelDownloadDidSucceed, object: nil, queue: nil) { note in
        if matches(note) { finish(nil) }
      })
      tokens.append(NotificationCenter.default.addObserver(forName: .mlkitModelDownloadDidFail, object: nil, queue: nil) { note in
        if matches(note) {
          finish(note.userInfo?[ModelDownloadUserInfoKey.error.rawValue] as? Error ?? TranslatorError.downloadFailed(language))
        }
      })
      let progress = manager.download(model, conditions: conditions)
      progressObservations[language] = progress.observe(\.fractionCompleted) { [weak self] p, _ in
        self?.sendEvent("onDownloadProgress", ["language": language, "progress": p.fractionCompleted])
      }
    }
  }
  #endif

  // MARK: - Text recognition (Apple Vision)

  private static func visionLanguages() -> [String] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    return (try? request.supportedRecognitionLanguages()) ?? []
  }

  private static func recognize(uri: String, languages: [String]) async throws -> [String: Any] {
    let path = uri.hasPrefix("file://") ? (URL(string: uri)?.path ?? uri) : uri
    guard let image = UIImage(contentsOfFile: path), let cgImage = image.cgImage else {
      throw TranslatorError.badImage
    }
    let supported = visionLanguages()
    // Match "ar" to "ar-SA", "zh" to "zh-Hans" and so on.
    let wanted = languages.flatMap { code in supported.filter { $0 == code || $0.hasPrefix(code + "-") } }

    return try await withCheckedThrowingContinuation { c in
      let request = VNRecognizeTextRequest { request, error in
        if let error { return c.resume(throwing: error) }
        let observations = (request.results as? [VNRecognizedTextObservation]) ?? []
        var blocks: [[String: Any]] = []
        var lines: [String] = []
        for o in observations {
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
      request.recognitionLevel = .accurate
      request.usesLanguageCorrection = true
      if wanted.isEmpty {
        request.automaticallyDetectsLanguage = true
      } else {
        request.recognitionLanguages = wanted
      }
      let handler = VNImageRequestHandler(cgImage: cgImage, orientation: CGImagePropertyOrientation(image.imageOrientation))
      DispatchQueue.global(qos: .userInitiated).async {
        do { try handler.perform([request]) } catch { c.resume(throwing: error) }
      }
    }
  }
}

enum TranslatorError: LocalizedError, CustomStringConvertible {
  case unavailable
  case modelMissing(String)
  case downloadFailed(String)
  case badImage

  var description: String {
    switch self {
    case .unavailable: return "ON_DEVICE_UNAVAILABLE"
    case .modelMissing(let lang): return "MODEL_MISSING:\(lang)"
    case .downloadFailed(let lang): return "DOWNLOAD_FAILED:\(lang)"
    case .badImage: return "BAD_IMAGE"
    }
  }

  // Expo passes localizedDescription to JavaScript as the error message.
  var errorDescription: String? { description }
}

extension CGImagePropertyOrientation {
  init(_ o: UIImage.Orientation) {
    switch o {
    case .up: self = .up
    case .down: self = .down
    case .left: self = .left
    case .right: self = .right
    case .upMirrored: self = .upMirrored
    case .downMirrored: self = .downMirrored
    case .leftMirrored: self = .leftMirrored
    case .rightMirrored: self = .rightMirrored
    @unknown default: self = .up
    }
  }
}
