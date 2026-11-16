package ai.artell.quickcapture

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import org.json.JSONArray

/** One note as the widget shows it. */
data class WidgetNote(val id: String, val title: String, val text: String, val color: Int?)

/**
 * What the widget shows, written by the app each time the notes change. The
 * widget never reads the vault: it draws what it was last told, which is why it
 * still has something to show when the app is not running.
 */
object WidgetStore {
  private const val PREFS = "quick_capture_widget"
  private const val NOTES = "notes"

  fun write(context: Context, json: String) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(NOTES, json).apply()
  }

  fun read(context: Context): List<WidgetNote> {
    val json =
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(NOTES, null)
        ?: return emptyList()
    return try {
      val array = JSONArray(json)
      (0 until array.length()).map { index ->
        val item = array.getJSONObject(index)
        WidgetNote(
          id = item.getString("id"),
          title = item.optString("title"),
          text = item.optString("text"),
          color = item.optString("color").takeIf { it.isNotEmpty() }?.let(::colorOf),
        )
      }
    } catch (error: Exception) {
      emptyList()
    }
  }

  private fun colorOf(value: String): Int? =
    try {
      Color.parseColor(value)
    } catch (error: IllegalArgumentException) {
      null
    }
}

/** The widget: a line to write a note from, and the pinned notes under it. */
class NotesWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    draw(context, manager, ids)
  }

  companion object {
    private const val SCHEME = "markdown-viewer"

    /** Called by the app when the notes it shows changed. */
    fun refresh(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, NotesWidgetProvider::class.java))
      if (ids.isNotEmpty()) draw(context, manager, ids)
    }

    private fun draw(context: Context, manager: AppWidgetManager, ids: IntArray) {
      for (id in ids) manager.updateAppWidget(id, views(context, id))
      @Suppress("DEPRECATION")
      manager.notifyAppWidgetViewDataChanged(ids, R.id.quick_capture_list)
    }

    private fun views(context: Context, id: Int): RemoteViews {
      val views = RemoteViews(context.packageName, R.layout.quick_capture_widget)

      val service =
        Intent(context, NotesWidgetService::class.java).apply {
          putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
          // Each widget its own adapter: the data is what tells two intents apart.
          data = Uri.parse(toUri(Intent.URI_INTENT_SCHEME))
        }
      @Suppress("DEPRECATION")
      views.setRemoteAdapter(R.id.quick_capture_list, service)
      views.setEmptyView(R.id.quick_capture_list, R.id.quick_capture_empty)

      // A row opens its note: the row fills in which one.
      val open = Intent(Intent.ACTION_VIEW).setPackage(context.packageName)
      views.setPendingIntentTemplate(
        R.id.quick_capture_list,
        PendingIntent.getActivity(
          context,
          0,
          open,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
        ),
      )

      val capture =
        Intent(Intent.ACTION_VIEW, Uri.parse("$SCHEME://capture")).setPackage(context.packageName)
      val write =
        PendingIntent.getActivity(
          context,
          1,
          capture,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
      views.setOnClickPendingIntent(R.id.quick_capture_field, write)
      views.setOnClickPendingIntent(R.id.quick_capture_new, write)
      return views
    }

    fun noteAddress(id: String): Uri = Uri.parse("$SCHEME://note?id=" + Uri.encode(id))
  }
}

class NotesWidgetService : RemoteViewsService() {
  override fun onGetViewFactory(intent: Intent): RemoteViewsFactory =
    NotesFactory(applicationContext)
}

private class NotesFactory(private val context: Context) : RemoteViewsService.RemoteViewsFactory {
  private var notes: List<WidgetNote> = emptyList()

  override fun onCreate() {}

  override fun onDataSetChanged() {
    notes = WidgetStore.read(context)
  }

  override fun onDestroy() {}

  override fun getCount(): Int = notes.size

  override fun getViewAt(position: Int): RemoteViews? {
    val note = notes.getOrNull(position) ?: return null
    val row = RemoteViews(context.packageName, R.layout.quick_capture_item)
    row.setTextViewText(R.id.quick_capture_item_title, note.title)
    row.setTextViewText(R.id.quick_capture_item_text, note.text)
    row.setViewVisibility(
      R.id.quick_capture_item_text,
      if (note.text.isBlank()) View.GONE else View.VISIBLE,
    )
    note.color?.let { row.setInt(R.id.quick_capture_item_bar, "setBackgroundColor", it) }
    row.setOnClickFillInIntent(
      R.id.quick_capture_item,
      Intent().setData(NotesWidgetProvider.noteAddress(note.id)),
    )
    return row
  }

  override fun getLoadingView(): RemoteViews? = null

  override fun getViewTypeCount(): Int = 1

  override fun getItemId(position: Int): Long = position.toLong()

  override fun hasStableIds(): Boolean = false
}
