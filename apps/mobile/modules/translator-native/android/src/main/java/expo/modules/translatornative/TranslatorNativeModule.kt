package expo.modules.translatornative

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.common.model.RemoteModelManager
import com.google.mlkit.nl.languageid.LanguageIdentification
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
import java.util.concurrent.ConcurrentHashMap

/**
 * On-device translation, language identification and text recognition with Google ML Kit.
 * Only the one-time model downloads use the network.
 */
class TranslatorNativeModule : Module() {
  private val translators = ConcurrentHashMap<String, Translator>()
  private val modelManager by lazy { RemoteModelManager.getInstance() }
  private val languageId by lazy { LanguageIdentification.getClient() }

  override fun definition() = ModuleDefinition {
    Name("TranslatorNative")

    Events("onDownloadProgress")

    Function("isTranslationAvailable") { true }
    Function("isTextRecognitionAvailable") { true }
    Function("supportedRecognitionLanguages") { listOf("latin", "chinese", "devanagari", "japanese", "korean") }

    AsyncFunction("translate") { text: String, source: String, target: String, promise: Promise ->
      modelManager.getDownloadedModels(TranslateRemoteModel::class.java)
        .addOnSuccessListener { models ->
          val have = models.map { it.language }.toSet()
          val missing = listOf(source, target).firstOrNull { it !in have }
          if (missing != null) {
            promise.reject(CodedException("MODEL_MISSING", "MODEL_MISSING:$missing", null))
            return@addOnSuccessListener
          }
          translator(source, target).translate(text)
            .addOnSuccessListener { promise.resolve(it) }
            .addOnFailureListener { promise.reject(CodedException("TRANSLATE_FAILED", it.message ?: "Translation failed", it)) }
        }
        .addOnFailureListener { promise.reject(CodedException("TRANSLATE_FAILED", it.message ?: "Translation failed", it)) }
    }

    AsyncFunction("downloadModel") { language: String, wifiOnly: Boolean, promise: Promise ->
      val conditions = DownloadConditions.Builder().apply { if (wifiOnly) requireWifi() }.build()
      sendEvent("onDownloadProgress", mapOf("language" to language, "progress" to 0.0))
      modelManager.download(TranslateRemoteModel.Builder(language).build(), conditions)
        .addOnSuccessListener {
          sendEvent("onDownloadProgress", mapOf("language" to language, "progress" to 1.0))
          promise.resolve(null)
        }
        .addOnFailureListener { promise.reject(CodedException("DOWNLOAD_FAILED", "DOWNLOAD_FAILED:$language", it)) }
    }

    AsyncFunction("deleteModel") { language: String, promise: Promise ->
      modelManager.deleteDownloadedModel(TranslateRemoteModel.Builder(language).build())
        .addOnSuccessListener {
          translators.keys.filter { it.contains(language) }.forEach { translators.remove(it)?.close() }
          promise.resolve(null)
        }
        .addOnFailureListener { promise.reject(CodedException("DELETE_FAILED", it.message ?: "Delete failed", it)) }
    }

    AsyncFunction("getDownloadedModels") { promise: Promise ->
      modelManager.getDownloadedModels(TranslateRemoteModel::class.java)
        .addOnSuccessListener { models -> promise.resolve(models.map { it.language }) }
        .addOnFailureListener { promise.reject(CodedException("LIST_FAILED", it.message ?: "List failed", it)) }
    }

    AsyncFunction("identifyLanguage") { text: String, promise: Promise ->
      languageId.identifyLanguage(text)
        .addOnSuccessListener { promise.resolve(it) }
        .addOnFailureListener { promise.resolve("und") }
    }

    AsyncFunction("recognizeText") { uri: String, languages: List<String>, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject(CodedException("NO_CONTEXT", "No Android context", null))
        return@AsyncFunction
      }
      val image = try {
        InputImage.fromFilePath(context, Uri.parse(uri))
      } catch (e: Exception) {
        promise.reject(CodedException("BAD_IMAGE", "BAD_IMAGE", e))
        return@AsyncFunction
      }
      val recognizer = recognizerFor(languages)
      recognizer.process(image)
        .addOnSuccessListener { result ->
          val w = image.width.toDouble().coerceAtLeast(1.0)
          val h = image.height.toDouble().coerceAtLeast(1.0)
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
          recognizer.close()
        }
        .addOnFailureListener {
          recognizer.close()
          promise.reject(CodedException("OCR_FAILED", it.message ?: "Text recognition failed", it))
        }
    }

    // Android has no PDF text API: each page is rendered and read with on-device OCR.
    AsyncFunction("extractPdfText") { uri: String, languages: List<String>, maxPages: Int, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject(CodedException("NO_CONTEXT", "No Android context", null))
        return@AsyncFunction
      }
      Thread {
        try {
          val descriptor = context.contentResolver.openFileDescriptor(Uri.parse(uri), "r")
            ?: throw IllegalStateException("BAD_PDF")
          descriptor.use { fd ->
            PdfRenderer(fd).use { renderer ->
              val recognizer = recognizerFor(languages)
              val count = minOf(renderer.pageCount, maxOf(1, maxPages))
              val pages = ArrayList<String>(count)
              for (i in 0 until count) {
                renderer.openPage(i).use { page ->
                  // About 150 dpi: sharp enough for OCR, small enough for memory.
                  val scale = 150f / 72f
                  val bitmap = Bitmap.createBitmap((page.width * scale).toInt(), (page.height * scale).toInt(), Bitmap.Config.ARGB_8888)
                  bitmap.eraseColor(Color.WHITE)
                  page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                  val result = Tasks.await(recognizer.process(InputImage.fromBitmap(bitmap, 0)))
                  pages.add(result.text)
                  bitmap.recycle()
                }
              }
              recognizer.close()
              promise.resolve(mapOf("pages" to pages, "pageCount" to renderer.pageCount, "scannedPages" to count))
            }
          }
        } catch (e: SecurityException) {
          promise.reject(CodedException("LOCKED_PDF", "LOCKED_PDF", e))
        } catch (e: Exception) {
          promise.reject(CodedException("BAD_PDF", "BAD_PDF", e))
        }
      }.start()
    }

    OnDestroy {
      translators.values.forEach { it.close() }
      translators.clear()
      languageId.close()
    }
  }

  private fun translator(source: String, target: String): Translator =
    translators.getOrPut("$source>$target") {
      Translation.getClient(TranslatorOptions.Builder().setSourceLanguage(source).setTargetLanguage(target).build())
    }

  /** ML Kit reads one script per recognizer; pick it from the expected languages. */
  private fun recognizerFor(languages: List<String>): TextRecognizer {
    val base = languages.map { it.substringBefore('-') }
    return when {
      base.any { it == "zh" } -> TextRecognition.getClient(ChineseTextRecognizerOptions.Builder().build())
      base.any { it == "ja" } -> TextRecognition.getClient(JapaneseTextRecognizerOptions.Builder().build())
      base.any { it == "ko" } -> TextRecognition.getClient(KoreanTextRecognizerOptions.Builder().build())
      base.any { it in setOf("hi", "mr", "ne", "sa", "bho", "mai", "doi", "gom") } ->
        TextRecognition.getClient(DevanagariTextRecognizerOptions.Builder().build())
      else -> TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    }
  }
}
