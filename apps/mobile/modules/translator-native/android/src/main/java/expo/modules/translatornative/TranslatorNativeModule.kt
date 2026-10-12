package expo.modules.translatornative

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.media.ExifInterface
import android.net.Uri
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.common.MlKitException
import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.common.model.RemoteModelManager
import com.google.mlkit.nl.languageid.LanguageIdentification
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.TranslateRemoteModel
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.Translator
import com.google.mlkit.nl.translate.TranslatorOptions
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import com.google.mlkit.vision.text.devanagari.DevanagariTextRecognizerOptions
import com.google.mlkit.vision.text.japanese.JapaneseTextRecognizerOptions
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

/**
 * On-device translation, language identification and text recognition with Google ML Kit.
 * Only the one-time model downloads use the network.
 *
 * Errors reach JavaScript with a stable code (the same codes as on iOS, see [nativeError]).
 * Task listeners run on the main thread, where an uncaught exception ends the app, so work
 * that can throw is kept out of them or guarded.
 */
class TranslatorNativeModule : Module() {
  private val translators = ConcurrentHashMap<String, Translator>()
  private val modelManager by lazy { RemoteModelManager.getInstance() }
  private val languageId = lazy { LanguageIdentification.getClient() }
  private val supportedLanguages by lazy { TranslateLanguage.getAllLanguages().toSet() }

  /** Renders and reads PDF pages one at a time, off the JavaScript and module threads. */
  private val pdfWorker: ExecutorService = Executors.newSingleThreadExecutor()

  override fun definition() = ModuleDefinition {
    Name("TranslatorNative")

    Events("onDownloadProgress")

    Function("isTranslationAvailable") { true }
    Function("isTextRecognitionAvailable") { true }
    Function("supportedRecognitionLanguages") { listOf("latin", "chinese", "devanagari", "japanese", "korean") }
    // Registered URL schemes matter only to Google Sign-In on iOS; kept for a uniform API.
    Function("urlSchemes") { emptyList<String>() }

    AsyncFunction("translate") { text: String, source: String, target: String, promise: Promise ->
      val unsupported = listOf(source, target).firstOrNull { it !in supportedLanguages }
      if (unsupported != null) {
        promise.reject(nativeError("UNSUPPORTED_LANGUAGE", unsupported))
        return@AsyncFunction
      }
      modelManager.getDownloadedModels(TranslateRemoteModel::class.java)
        .addOnSuccessListener { models ->
          val have = models.map { it.language }.toSet()
          val missing = listOf(source, target).firstOrNull { it !in have }
          if (missing != null) {
            promise.reject(nativeError("MODEL_MISSING", missing))
            return@addOnSuccessListener
          }
          try {
            translator(source, target).translate(text)
              .addOnSuccessListener { promise.resolve(it) }
              .addOnFailureListener { promise.reject(nativeError("TRANSLATE_FAILED", cause = it)) }
          } catch (e: Exception) {
            promise.reject(nativeError("TRANSLATE_FAILED", cause = e))
          }
        }
        .addOnFailureListener { promise.reject(nativeError("TRANSLATE_FAILED", cause = it)) }
    }

    AsyncFunction("downloadModel") { language: String, wifiOnly: Boolean, promise: Promise ->
      if (language !in supportedLanguages) {
        promise.reject(nativeError("UNSUPPORTED_LANGUAGE", language))
        return@AsyncFunction
      }
      val conditions = DownloadConditions.Builder().apply { if (wifiOnly) requireWifi() }.build()
      // ML Kit reports no progress on Android, only the start and the end.
      sendEvent("onDownloadProgress", mapOf("language" to language, "progress" to 0.0))
      modelManager.download(TranslateRemoteModel.Builder(language).build(), conditions)
        .addOnSuccessListener {
          sendEvent("onDownloadProgress", mapOf("language" to language, "progress" to 1.0))
          promise.resolve(null)
        }
        .addOnFailureListener { promise.reject(nativeError("DOWNLOAD_FAILED", language, it)) }
    }

    AsyncFunction("deleteModel") { language: String, promise: Promise ->
      if (language !in supportedLanguages) {
        promise.reject(nativeError("UNSUPPORTED_LANGUAGE", language))
        return@AsyncFunction
      }
      modelManager.deleteDownloadedModel(TranslateRemoteModel.Builder(language).build())
        .addOnSuccessListener {
          translators.keys.filter { key -> key.split('>').contains(language) }.forEach { translators.remove(it)?.close() }
          promise.resolve(null)
        }
        .addOnFailureListener { promise.reject(nativeError("DELETE_FAILED", language, it)) }
    }

    AsyncFunction("getDownloadedModels") { promise: Promise ->
      modelManager.getDownloadedModels(TranslateRemoteModel::class.java)
        .addOnSuccessListener { models -> promise.resolve(models.map { it.language }) }
        .addOnFailureListener { promise.reject(nativeError("LIST_FAILED", cause = it)) }
    }

    // Unsure and failed both mean "und", as on iOS.
    AsyncFunction("identifyLanguage") { text: String, promise: Promise ->
      try {
        languageId.value.identifyLanguage(text)
          .addOnSuccessListener { promise.resolve(it) }
          .addOnFailureListener { promise.resolve("und") }
      } catch (e: Exception) {
        promise.resolve("und")
      }
    }

    AsyncFunction("recognizeText") { uri: String, languages: List<String>, promise: Promise ->
      val context = appContext.reactContext ?: run {
        promise.reject(nativeError("NO_CONTEXT"))
        return@AsyncFunction
      }
      val decoded = try {
        decodeImage(context, uri)
      } catch (t: Throwable) {
        // OutOfMemoryError included: a broken or huge file must not end the app.
        promise.reject(nativeError("BAD_IMAGE", cause = t))
        return@AsyncFunction
      }
      // Boxes come back in the upright frame, so a quarter turn swaps width and height.
      val quarterTurn = decoded.rotation % 180 != 0
      val w = (if (quarterTurn) decoded.bitmap.height else decoded.bitmap.width).toDouble().coerceAtLeast(1.0)
      val h = (if (quarterTurn) decoded.bitmap.width else decoded.bitmap.height).toDouble().coerceAtLeast(1.0)
      val recognizer = recognizerFor(languages)
      try {
        recognizer.process(InputImage.fromBitmap(decoded.bitmap, decoded.rotation))
          .addOnSuccessListener { result ->
            val blocks = result.textBlocks.map { block ->
              val box = block.boundingBox
              mapOf(
                "text" to block.text,
                "frame" to mapOf(
                  "x" to (box?.left ?: 0) / w,
                  "y" to (box?.top ?: 0) / h,
                  "width" to (box?.width() ?: 0) / w,
                  "height" to (box?.height() ?: 0) / h,
                ),
              )
            }
            promise.resolve(mapOf("text" to result.text, "blocks" to blocks))
          }
          .addOnFailureListener { promise.reject(ocrError(it)) }
          .addOnCompleteListener {
            recognizer.close()
            decoded.bitmap.recycle()
          }
      } catch (e: Exception) {
        recognizer.close()
        decoded.bitmap.recycle()
        promise.reject(ocrError(e))
      }
    }

    // Android has no PDF text API: each page is rendered and read with on-device OCR.
    AsyncFunction("extractPdfText") { uri: String, languages: List<String>, maxPages: Int, promise: Promise ->
      val context = appContext.reactContext ?: run {
        promise.reject(nativeError("NO_CONTEXT"))
        return@AsyncFunction
      }
      try {
        pdfWorker.execute { extractPdf(context, uri, languages, maxPages, promise) }
      } catch (e: RejectedExecutionException) {
        promise.reject(nativeError("BAD_PDF", cause = e))
      }
    }

    OnDestroy {
      pdfWorker.shutdownNow()
      translators.values.forEach { it.close() }
      translators.clear()
      if (languageId.isInitialized()) languageId.value.close()
    }
  }

  private fun translator(source: String, target: String): Translator =
    translators.computeIfAbsent("$source>$target") {
      Translation.getClient(TranslatorOptions.Builder().setSourceLanguage(source).setTargetLanguage(target).build())
    }

  /** ML Kit reads one script per recognizer; pick it from the expected languages. */
  private fun recognizerFor(languages: List<String>): TextRecognizer {
    val base = languages.map { it.substringBefore('-') }
    return when {
      base.any { it == "zh" } -> TextRecognition.getClient(ChineseTextRecognizerOptions.Builder().build())
      base.any { it == "ja" } -> TextRecognition.getClient(JapaneseTextRecognizerOptions.Builder().build())
      base.any { it == "ko" } -> TextRecognition.getClient(KoreanTextRecognizerOptions.Builder().build())
      base.any { it in DEVANAGARI } -> TextRecognition.getClient(DevanagariTextRecognizerOptions.Builder().build())
      else -> TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    }
  }

  // Images

  private class DecodedImage(val bitmap: Bitmap, val rotation: Int)

  /**
   * Decodes a photo at most [MAX_IMAGE_SIDE] px on its longer side (a 50 MP photo at full
   * size needs 200 MB) and reads its EXIF rotation, which ML Kit applies itself.
   */
  private fun decodeImage(context: Context, uri: String): DecodedImage {
    val resolver = context.contentResolver
    val source = toUri(uri)
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    resolver.openInputStream(source)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    val longest = maxOf(bounds.outWidth, bounds.outHeight)
    require(longest > 0) { "Not an image" }
    var sample = 1
    while (longest / sample > MAX_IMAGE_SIDE) sample *= 2
    val options = BitmapFactory.Options().apply { inSampleSize = sample }
    val bitmap = resolver.openInputStream(source)?.use { BitmapFactory.decodeStream(it, null, options) }
      ?: throw IllegalArgumentException("Not an image")
    val rotation = try {
      resolver.openInputStream(source)?.use { exifRotation(ExifInterface(it)) } ?: 0
    } catch (e: Exception) {
      0
    }
    return DecodedImage(bitmap, rotation)
  }

  private fun exifRotation(exif: ExifInterface): Int =
    when (exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
      ExifInterface.ORIENTATION_ROTATE_90 -> 90
      ExifInterface.ORIENTATION_ROTATE_180 -> 180
      ExifInterface.ORIENTATION_ROTATE_270 -> 270
      else -> 0
    }

  /** Accepts file:// and content:// URIs and plain file paths. */
  private fun toUri(uri: String): Uri = if (uri.startsWith("/")) Uri.fromFile(File(uri)) else Uri.parse(uri)

  // PDF

  /** Runs on [pdfWorker]. Every outcome settles the promise, including OutOfMemoryError. */
  private fun extractPdf(context: Context, uri: String, languages: List<String>, maxPages: Int, promise: Promise) {
    var recognizer: TextRecognizer? = null
    try {
      val descriptor = context.contentResolver.openFileDescriptor(toUri(uri), "r")
        ?: throw IllegalArgumentException("Cannot open the file")
      descriptor.use { fd ->
        PdfRenderer(fd).use { renderer ->
          val reader = recognizerFor(languages).also { recognizer = it }
          val count = minOf(renderer.pageCount, maxOf(1, maxPages))
          val pages = ArrayList<String>(count)
          var scanned = 0
          for (i in 0 until count) {
            val text = readPage(renderer, i, reader)
            pages.add(text ?: "")
            if (text != null) scanned++
          }
          promise.resolve(mapOf("pages" to pages, "pageCount" to renderer.pageCount, "scannedPages" to scanned))
        }
      }
    } catch (e: SecurityException) {
      // PdfRenderer throws this for password-protected files.
      promise.reject(nativeError("LOCKED_PDF", cause = e))
    } catch (t: Throwable) {
      promise.reject(if (isModelUnavailable(t)) nativeError("OCR_UNAVAILABLE", cause = t) else nativeError("BAD_PDF", cause = t))
    } finally {
      recognizer?.close()
    }
  }

  /**
   * Renders one page at about 150 dpi, with the longer side capped at [MAX_PDF_SIDE] px (a
   * poster-sized page would need hundreds of megabytes), and reads it. Returns null when this
   * page cannot be read, so one bad page does not lose the rest of the document.
   */
  private fun readPage(renderer: PdfRenderer, index: Int, recognizer: TextRecognizer): String? {
    var bitmap: Bitmap? = null
    try {
      val rendered = renderer.openPage(index).use { page ->
        val longest = maxOf(page.width, page.height).coerceAtLeast(1)
        val scale = minOf(150f / 72f, MAX_PDF_SIDE / longest)
        val width = (page.width * scale).toInt().coerceAtLeast(1)
        val height = (page.height * scale).toInt().coerceAtLeast(1)
        Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).also { b ->
          bitmap = b
          b.eraseColor(Color.WHITE)
          page.render(b, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
        }
      }
      return Tasks.await(recognizer.process(InputImage.fromBitmap(rendered, 0))).text
    } catch (e: InterruptedException) {
      throw e
    } catch (e: Exception) {
      // Without the recognition model no page can be read; stop instead of returning blanks.
      if (isModelUnavailable(e)) throw e
      return null
    } finally {
      bitmap?.recycle()
    }
  }

  private companion object {
    /** Longest side, in pixels, of a photo handed to text recognition. */
    const val MAX_IMAGE_SIDE = 3000

    /** Longest side, in pixels, of a rendered PDF page (A4 at 150 dpi is 1754). */
    const val MAX_PDF_SIDE = 2200f

    val DEVANAGARI = setOf("hi", "mr", "ne", "sa", "bho", "mai", "doi", "gom")
  }
}

/**
 * Errors with a stable code for JavaScript; iOS rejects with the same codes. The message keeps
 * the "CODE:detail" form (e.g. "MODEL_MISSING:ar") so the detail survives.
 */
private fun nativeError(code: String, detail: String? = null, cause: Throwable? = null) =
  CodedException(code, if (detail == null) code else "$code:$detail", cause)

/**
 * Google Play services delivers the text recognition model after install; until it arrives,
 * ML Kit fails with UNAVAILABLE.
 */
private fun isModelUnavailable(t: Throwable): Boolean {
  val e = t as? MlKitException ?: t.cause as? MlKitException
  return e?.errorCode == MlKitException.UNAVAILABLE
}

private fun ocrError(t: Throwable) =
  if (isModelUnavailable(t)) nativeError("OCR_UNAVAILABLE", cause = t) else nativeError("OCR_FAILED", cause = t)
