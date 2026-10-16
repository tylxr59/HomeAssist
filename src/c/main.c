#include <pebble.h>

#define MAX_TRANSCRIPT 1024
#define MAX_REPLY 8192
enum { HELLO, CONFIG, COMMAND, CHUNK, ERROR, ACK };
static Window *s_window;
static TextLayer *s_title, *s_text, *s_footer;
static ScrollLayer *s_scroll;
static DictationSession *s_dictation;
static AppTimer *s_timer;
static char s_reply[MAX_REPLY + 1];
static char s_assistant[96] = "HomeAssist";
static uint32_t s_request, s_config_revision;
static uint16_t s_next_chunk;
static bool s_ready, s_busy, s_listening, s_auto_started, s_received_config, s_complete;

static void show(const char *text) {
  if (text != s_reply) snprintf(s_reply, sizeof(s_reply), "%s", text);
  text_layer_set_text(s_text, s_reply);
  text_layer_set_size(s_text, GSize(184, 30000));
  GSize size = text_layer_get_content_size(s_text);
  int height = size.h > 146 ? size.h + 8 : 146;
  text_layer_set_size(s_text, GSize(184, height));
  scroll_layer_set_content_size(s_scroll, GSize(200, height));
  scroll_layer_set_content_offset(s_scroll, GPointZero, false);
}
static void footer(const char *text) { text_layer_set_text(s_footer, text); }
static void cancel_timer(void) { if (s_timer) { app_timer_cancel(s_timer); s_timer = NULL; } }
static void timeout(void *context) {
  s_timer = NULL;
  s_busy = false;
  s_request++; // Late results must not overwrite this error.
  show(s_received_config ? "Request timed out. It may have run. Check Home Assistant before trying again." : "Phone companion unavailable. Check Bluetooth and reopen HomeAssist.");
  footer("SELECT: speak   BACK: exit");
}
static void deadline(uint32_t ms) { cancel_timer(); s_timer = app_timer_register(ms, timeout, NULL); }
static void send_hello(void) {
  DictionaryIterator *it;
  if (app_message_outbox_begin(&it) == APP_MSG_OK) { dict_write_uint8(it, MESSAGE_KEY_Type, HELLO); app_message_outbox_send(); }
}
static void dictate(void);
static void dictation_result(DictationSession *session, DictationSessionStatus status, char *text, void *context);
static void start_automatic(void *context) { s_timer = NULL; dictate(); }
static void dictate(void) {
  if (s_busy || s_listening) return;
  if (!s_ready) { show("Open HomeAssist settings in the phone companion. Save your URL and token, then reopen settings to choose an assistant."); return; }
  if (!s_dictation) s_dictation = dictation_session_create(0, dictation_result, NULL);
  if (!s_dictation) { show("Dictation unavailable. Check the phone connection and speech service."); return; }
  dictation_session_enable_confirmation(s_dictation, false);
  dictation_session_enable_error_dialogs(s_dictation, false);
  s_listening = true;
  if (dictation_session_start(s_dictation) != DictationSessionStatusSuccess) { s_listening = false; show("Could not start dictation. Check your phone and try again."); }
}
static void dictation_result(DictationSession *session, DictationSessionStatus status, char *text, void *context) {
  s_listening = false;
  if (status != DictationSessionStatusSuccess) {
    show(status == DictationSessionStatusFailureTranscriptionRejected || status == DictationSessionStatusFailureSystemAborted ? "Cancelled. Press SELECT to speak." : status == DictationSessionStatusFailureNoSpeechDetected ? "No speech detected. Press SELECT to try again." : "Speech recognition failed. Check your phone connection and speech service.");
    footer("SELECT: speak   BACK: exit"); return;
  }
  if (!text || !text[0]) { show("No speech detected. Please try again."); return; }
  if (strlen(text) > MAX_TRANSCRIPT) { show("Command too long. Please try a shorter command."); return; }
  DictionaryIterator *it;
  if (app_message_outbox_begin(&it) != APP_MSG_OK) { show("Phone connection busy. Press SELECT to try again."); return; }
  s_request++; s_next_chunk = 0; s_complete = false;
  dict_write_uint8(it, MESSAGE_KEY_Type, COMMAND);
  dict_write_uint32(it, MESSAGE_KEY_RequestId, s_request);
  dict_write_cstring(it, MESSAGE_KEY_Text, text);
  show(text); footer("Asking Home Assistant…"); s_busy = true;
  if (app_message_outbox_send() != APP_MSG_OK) { s_busy = false; show("Could not send. Check your phone connection."); footer("SELECT: speak   BACK: exit"); return; }
  deadline(80000);
}
static void select_click(ClickRecognizerRef recognizer, void *context) {
  if (!s_received_config) { send_hello(); deadline(15000); return; }
  dictate();
}
static void clicks(void *context) {
  window_single_click_subscribe(BUTTON_ID_SELECT, select_click);
}
static void acknowledge(uint32_t id, uint16_t index) {
  DictionaryIterator *it;
  if (app_message_outbox_begin(&it) != APP_MSG_OK) return;
  dict_write_uint8(it, MESSAGE_KEY_Type, ACK);
  dict_write_uint32(it, MESSAGE_KEY_RequestId, id);
  dict_write_uint16(it, MESSAGE_KEY_ChunkIndex, index);
  app_message_outbox_send();
}
static void inbox(DictionaryIterator *it, void *context) {
  Tuple *type = dict_find(it, MESSAGE_KEY_Type);
  if (!type) return;
  Tuple *text = dict_find(it, MESSAGE_KEY_Text);
  if (type->value->uint8 == CONFIG) {
    Tuple *ready = dict_find(it, MESSAGE_KEY_Ready), *name = dict_find(it, MESSAGE_KEY_Assistant);
    Tuple *revision = dict_find(it, MESSAGE_KEY_RequestId);
    uint32_t rev = revision ? revision->value->uint32 : 0;
    bool now_ready = ready && ready->value->uint8;
    if (s_received_config && now_ready && s_ready && rev == s_config_revision) return;
    s_config_revision = rev;
    s_received_config = true;
    if (s_busy || s_listening) {
      if (s_listening && s_dictation) dictation_session_stop(s_dictation);
      s_listening = false; s_busy = false; s_request++;
    }
    cancel_timer();
    s_ready = ready && ready->value->uint8;
    if (name && name->length > 1) snprintf(s_assistant, sizeof(s_assistant), "%s", name->value->cstring);
    text_layer_set_text(s_title, s_assistant);
    footer("SELECT: speak   BACK: exit");
    if (!s_ready) show(text ? text->value->cstring : "Configure HomeAssist on your phone.");
    else if (!s_auto_started) { s_auto_started = true; s_timer = app_timer_register(100, start_automatic, NULL); }
    else show("Ready. Press SELECT to speak.");
    return;
  }
  Tuple *id = dict_find(it, MESSAGE_KEY_RequestId);
  if (!id || id->value->uint32 != s_request) return;
  if (type->value->uint8 == ERROR && s_busy) {
    cancel_timer(); s_busy = false; s_request++;
    show(text ? text->value->cstring : "Home Assistant request failed."); footer("SELECT: speak   BACK: exit");
  } else if (type->value->uint8 == CHUNK) {
    Tuple *index = dict_find(it, MESSAGE_KEY_ChunkIndex), *last = dict_find(it, MESSAGE_KEY_ChunkLast);
    if (!index || !last || !text) return;
    uint16_t n = index->value->uint16;
    if (n < s_next_chunk) { acknowledge(s_request, n); return; }
    if (!s_busy || s_complete || n != s_next_chunk) return;
    if (n == 0) s_reply[0] = '\0';
    size_t used = strlen(s_reply), added = strlen(text->value->cstring);
    if (used + added > MAX_REPLY) { cancel_timer(); s_busy = false; s_request++; show("Reply exceeded the display limit."); footer("SELECT: speak   BACK: exit"); return; }
    memcpy(s_reply + used, text->value->cstring, added + 1);
    s_next_chunk++;
    acknowledge(s_request, n);
    if (last->value->uint8) { s_complete = true; s_busy = false; cancel_timer(); show(s_reply); footer("SELECT: follow up   BACK: exit"); }
  }
}
static void outbox_failed(DictionaryIterator *it, AppMessageResult reason, void *context) {
  Tuple *type = dict_find(it, MESSAGE_KEY_Type);
  if (type && type->value->uint8 == COMMAND && s_busy) {
    cancel_timer(); s_busy = false; s_request++;
    show("Phone delivery failed. The command may have run; check Home Assistant."); footer("SELECT: speak   BACK: exit");
  }
}
static void init(void) {
  s_window = window_create(); window_set_background_color(s_window, GColorBlack);
  Layer *root = window_get_root_layer(s_window);
  s_title = text_layer_create(GRect(8, 4, 184, 30));
  text_layer_set_background_color(s_title, GColorBlack); text_layer_set_text_color(s_title, GColorWhite);
  text_layer_set_overflow_mode(s_title, GTextOverflowModeTrailingEllipsis);
  text_layer_set_font(s_title, fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD)); text_layer_set_text(s_title, s_assistant);
  layer_add_child(root, text_layer_get_layer(s_title));
  s_scroll = scroll_layer_create(GRect(0, 38, 200, 150));
  s_text = text_layer_create(GRect(8, 0, 184, 146));
  text_layer_set_background_color(s_text, GColorBlack); text_layer_set_text_color(s_text, GColorWhite);
  text_layer_set_font(s_text, fonts_get_system_font(FONT_KEY_GOTHIC_24));
  scroll_layer_add_child(s_scroll, text_layer_get_layer(s_text)); layer_add_child(root, scroll_layer_get_layer(s_scroll));
  s_footer = text_layer_create(GRect(6, 194, 188, 30));
  text_layer_set_background_color(s_footer, GColorBlack); text_layer_set_text_color(s_footer, GColorLightGray);
  text_layer_set_font(s_footer, fonts_get_system_font(FONT_KEY_GOTHIC_18));
  layer_add_child(root, text_layer_get_layer(s_footer));
  scroll_layer_set_click_config_onto_window(s_scroll, s_window); scroll_layer_set_callbacks(s_scroll, (ScrollLayerCallbacks){.click_config_provider = clicks});
  window_stack_push(s_window, true);
  show("Connecting to phone…"); footer("BACK: exit");
  app_message_register_inbox_received(inbox); app_message_register_outbox_failed(outbox_failed);
  app_message_open(2048, 2048);
  s_dictation = dictation_session_create(0, dictation_result, NULL);
  send_hello(); deadline(15000);
}
static void deinit(void) {
  cancel_timer(); if (s_dictation) dictation_session_destroy(s_dictation);
  text_layer_destroy(s_text); scroll_layer_destroy(s_scroll); text_layer_destroy(s_title); text_layer_destroy(s_footer); window_destroy(s_window);
}
int main(void) { init(); app_event_loop(); deinit(); }
