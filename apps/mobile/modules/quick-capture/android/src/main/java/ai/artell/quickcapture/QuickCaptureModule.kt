package ai.artell.quickcapture

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import androidx.core.os.bundleOf
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.IOException

/**
 * The two ways into the app that are not its icon: what another app hands over
 * with "Compartilhar", and the widget on the home screen. The app itself is
 * written in TypeScript; this is only what Android does not let it reach.
 */
class QuickCaptureModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("QuickCapture")

    Events("onShare", "onOpenFile")

    // A note opened from another app (a file manager, Drive, an e-mail), with
    // this app as the one for .md and .txt. Handed over once.
    Function("takeOpened") {
      val intent = appContext.currentActivity?.intent ?: return@Function null
      openedOf(intent)
    }

    // Saves the note back where it came from, when that app let us write.
    AsyncFunction("writeOpened") { address: String, text: String ->
      val output =
        context.contentResolver.openOutputStream(Uri.parse(address), "wt")
          ?: throw IOException("Não deu para salvar no arquivo de origem.")
      output.use { it.write(text.toByteArray(Charsets.UTF_8)) }
    }

    // What was shared with the app when it was opened by the share itself.
    // Handed over once: asking again gives nothing.
    Function("takeShared") {
      val intent = appContext.currentActivity?.intent ?: return@Function null
      sharedOf(intent)
    }

    // Shared while the app was already open.
    OnNewIntent { intent ->
      sharedOf(intent)?.let { sendEvent("onShare", it) }
      openedOf(intent)?.let { sendEvent("onOpenFile", it) }
    }

    // A shared picture comes as an address only the sharing app can read for
    // long. It is copied to the app's cache, where the vault can take it from.
    AsyncFunction("copyToCache") { address: String ->
      val uri = Uri.parse(address)
      val resolver = context.contentResolver
      val extension =
        MimeTypeMap.getSingleton().getExtensionFromMimeType(resolver.getType(uri)) ?: "jpg"
      val target = File(context.cacheDir, "shared-${System.nanoTime()}.$extension")
      val input =
        resolver.openInputStream(uri)
          ?: throw IOException("Não deu para ler o arquivo compartilhado.")
      input.use { from -> target.outputStream().use { to -> from.copyTo(to) } }
      Uri.fromFile(target).toString()
    }

    // The notes the widget shows, as JSON: [{ id, title, text, color }].
    Function("setWidgetNotes") { json: String ->
      WidgetStore.write(context, json)
      NotesWidgetProvider.refresh(context)
    }
  }

  private fun sharedOf(intent: Intent): Bundle? {
    val action = intent.action
    if (action != Intent.ACTION_SEND && action != Intent.ACTION_SEND_MULTIPLE) return null
    if (intent.getBooleanExtra(TAKEN, false)) return null
    intent.putExtra(TAKEN, true)

    val images = ArrayList<String>()
    if (action == Intent.ACTION_SEND) {
      streamOf(intent)?.let { images.add(it.toString()) }
    } else {
      streamsOf(intent)?.forEach { images.add(it.toString()) }
    }
    val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
    val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT)
    if (text.isNullOrBlank() && images.isEmpty()) return null
    return bundleOf("text" to (text ?: ""), "subject" to (subject ?: ""), "images" to images)
  }

  private fun openedOf(intent: Intent): Bundle? {
    if (intent.action != Intent.ACTION_VIEW) return null
    val uri = intent.data ?: return null
    if (uri.scheme != "content" && uri.scheme != "file") return null
    if (intent.getBooleanExtra(TAKEN, false)) return null
    intent.putExtra(TAKEN, true)

    val resolver = context.contentResolver
    var name = uri.lastPathSegment?.substringAfterLast('/') ?: "nota.md"
    var size = -1L
    if (uri.scheme == "content") {
      resolver.query(uri, null, null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
          val nameAt = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
          val sizeAt = cursor.getColumnIndex(OpenableColumns.SIZE)
          if (nameAt >= 0) cursor.getString(nameAt)?.let { name = it }
          if (sizeAt >= 0 && !cursor.isNull(sizeAt)) size = cursor.getLong(sizeAt)
        }
      }
    }
    if (size > MAX_OPENED) {
      return bundleOf("uri" to uri.toString(), "name" to name, "text" to "",
        "writable" to false, "error" to "O arquivo é grande demais para abrir como nota.")
    }
    return try {
      val text = resolver.openInputStream(uri)?.use { it.readBytes().toString(Charsets.UTF_8) }
        ?: throw IOException("Não deu para ler o arquivo.")
      val writable = uri.scheme == "file" ||
        (intent.flags and Intent.FLAG_GRANT_WRITE_URI_PERMISSION) != 0
      bundleOf("uri" to uri.toString(), "name" to name, "text" to text,
        "writable" to writable, "error" to "")
    } catch (error: Exception) {
      bundleOf("uri" to uri.toString(), "name" to name, "text" to "", "writable" to false,
        "error" to (error.message ?: "Não deu para ler o arquivo."))
    }
  }

  @Suppress("DEPRECATION")
  private fun streamOf(intent: Intent): Uri? =
    if (Build.VERSION.SDK_INT >= 33) {
      intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
    } else {
      intent.getParcelableExtra(Intent.EXTRA_STREAM)
    }

  @Suppress("DEPRECATION")
  private fun streamsOf(intent: Intent): List<Uri>? =
    if (Build.VERSION.SDK_INT >= 33) {
      intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
    } else {
      intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)
    }

  companion object {
    private const val TAKEN = "ai.artell.quickcapture.taken"
    /** Past this, a file opened from outside is not a note. */
    private const val MAX_OPENED = 10L * 1024 * 1024
  }
}
