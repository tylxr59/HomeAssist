#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
typedef void Window;
typedef void TextLayer;
typedef void StatusBarLayer;
typedef void Layer;
typedef void ScrollLayer;
typedef void DictationSession;
typedef void AppTimer;
typedef void *ClickRecognizerRef;
typedef int AppMessageResult;
typedef int DictationSessionStatus;
enum { APP_MSG_OK, APP_MSG_BUSY, BUTTON_ID_SELECT };
enum { DictationSessionStatusSuccess, DictationSessionStatusFailureTranscriptionRejected,
  DictationSessionStatusFailureSystemAborted, DictationSessionStatusFailureNoSpeechDetected };
enum { MESSAGE_KEY_Type, MESSAGE_KEY_RequestId, MESSAGE_KEY_Text, MESSAGE_KEY_Ready,
  MESSAGE_KEY_Assistant, MESSAGE_KEY_ChunkIndex, MESSAGE_KEY_ChunkLast };
typedef union { uint8_t uint8; uint16_t uint16; uint32_t uint32; char *cstring; } Value;
typedef struct { uint16_t length; Value *value; } Tuple;
typedef struct { Tuple tuples[7]; Value values[7]; bool present[7]; } DictionaryIterator;
static DictionaryIterator out;
static bool outbox_busy, session_available = true;
static int starts, stops, commands, hellos;
static uint32_t last_deadline;
static char command_text[1025], shown[8193];
static void show(const char *text) { snprintf(shown, sizeof(shown), "%s", text); }
static void footer(const char *text) {}
static void text_layer_set_text(TextLayer *layer, const char *text) {}
static void app_timer_cancel(AppTimer *timer) {}
static AppTimer *app_timer_register(uint32_t ms, void (*callback)(void *), void *context) {
  last_deadline = ms; return (AppTimer *)1;
}
static DictationSession *dictation_session_create(uint32_t size, void (*cb)(DictationSession *, DictationSessionStatus, char *, void *), void *ctx) { return session_available ? (DictationSession *)1 : NULL; }
static void dictation_session_enable_confirmation(DictationSession *session, bool enabled) {}
static void dictation_session_enable_error_dialogs(DictationSession *session, bool enabled) {}
static DictationSessionStatus dictation_session_start(DictationSession *session) { starts++; return DictationSessionStatusSuccess; }
static void dictation_session_stop(DictationSession *session) { stops++; }
static AppMessageResult app_message_outbox_begin(DictionaryIterator **it) {
  if (outbox_busy) return APP_MSG_BUSY;
  memset(&out, 0, sizeof(out)); *it = &out; return APP_MSG_OK;
}
static void dict_write_uint32(DictionaryIterator *it, int key, uint32_t value) {
  it->present[key] = true; it->values[key].uint32 = value;
  it->tuples[key].value = &it->values[key];
}
static void dict_write_uint8(DictionaryIterator *it, int key, uint8_t value) { dict_write_uint32(it, key, value); }
static void dict_write_uint16(DictionaryIterator *it, int key, uint16_t value) { dict_write_uint32(it, key, value); }
static void dict_write_cstring(DictionaryIterator *it, int key, const char *text) { snprintf(command_text, sizeof(command_text), "%s", text); }
static AppMessageResult app_message_outbox_send(void) {
  if (out.values[MESSAGE_KEY_Type].uint8 == 0) hellos++;
  if (out.values[MESSAGE_KEY_Type].uint8 == 2) commands++;
  return APP_MSG_OK;
}
static Tuple *dict_find(DictionaryIterator *it, int key) { return it->present[key] ? &it->tuples[key] : NULL; }
static void window_single_click_subscribe(int button, void (*handler)(ClickRecognizerRef, void *)) {}

/* WATCH_CODE */

static void config(bool ready, uint32_t revision) {
  DictionaryIterator it = {0};
  dict_write_uint8(&it, MESSAGE_KEY_Type, CONFIG);
  dict_write_uint8(&it, MESSAGE_KEY_Ready, ready);
  dict_write_uint32(&it, MESSAGE_KEY_RequestId, revision);
  inbox(&it, NULL);
}
static void reset(void) {
  s_ready = s_busy = s_listening = s_auto_started = s_received_config = s_complete = false;
  s_timer = s_start_timer = NULL; s_dictation = NULL;
  s_pending[0] = '\0'; s_request = s_config_revision = 0;
  starts = stops = commands = hellos = 0; outbox_busy = false; session_available = true;
}
int main(void) {
  // Readiness while listening must preserve the active session, including duplicates.
  reset(); start_automatic(NULL); assert(s_listening && starts == 1 && !s_received_config);
  config(true, 1); config(true, 1); assert(s_listening && stops == 0 && starts == 1);
  dictation_result(NULL, 0, "hello", NULL);
  assert(commands == 1 && s_busy && last_deadline == 80000);
  config(true, 1); outbox_sent(NULL, NULL); assert(commands == 1 && s_busy);

  // Recognition can finish first; its borrowed string must be copied until ready.
  reset(); start_automatic(NULL);
  char text[] = "turn on lamp";
  dictation_result(NULL, 0, text, NULL); text[0] = 'X';
  assert(commands == 0 && s_pending[0] && last_deadline == 15000);
  select_click(NULL, NULL); assert(starts == 1 && hellos == 0);
  config(true, 1); assert(commands == 1 && strcmp(command_text, "turn on lamp") == 0);
  assert(!s_pending[0]);

  // A busy startup outbox defers submission until its completion callback.
  reset(); start_automatic(NULL); dictation_result(NULL, 0, "hello", NULL);
  outbox_busy = true; config(true, 1); assert(commands == 0 && s_pending[0]);
  outbox_busy = false; outbox_sent(NULL, NULL); outbox_sent(NULL, NULL);
  assert(commands == 1 && !s_pending[0]);

  // A failed startup control message also releases the outbox for queued speech.
  reset(); start_automatic(NULL); dictation_result(NULL, 0, "hello", NULL);
  outbox_busy = true; config(true, 1); outbox_busy = false;
  DictionaryIterator hello = {0}; dict_write_uint8(&hello, MESSAGE_KEY_Type, HELLO);
  outbox_failed(&hello, APP_MSG_BUSY, NULL); assert(commands == 1);
  // A failed command is never replayed by another completion callback.
  outbox_failed(&out, APP_MSG_BUSY, NULL); outbox_sent(NULL, NULL);
  assert(commands == 1 && !s_busy && !s_pending[0]);

  // Timing out drops queued speech so late readiness cannot execute it.
  reset(); start_automatic(NULL); dictation_result(NULL, 0, "hello", NULL);
  timeout(NULL); config(true, 1); assert(commands == 0 && !s_pending[0]);
  assert(starts == 1 && !s_start_timer);
  reset(); start_automatic(NULL); timeout(NULL);
  assert(!s_listening && stops == 1);

  // Cancellation must not auto-reopen dictation when readiness arrives.
  reset(); start_automatic(NULL);
  dictation_result(NULL, DictationSessionStatusFailureTranscriptionRejected, NULL, NULL);
  config(true, 1); assert(commands == 0 && !s_start_timer && starts == 1);

  // Invalid setup and changed settings invalidate both queued speech and dictation.
  reset(); start_automatic(NULL); dictation_result(NULL, 0, "hello", NULL);
  config(false, 1); config(true, 1); assert(commands == 0 && !s_pending[0]);
  reset(); start_automatic(NULL); config(true, 1); config(true, 2);
  assert(stops == 1 && !s_listening);
  reset(); start_automatic(NULL); config(true, 1); outbox_busy = true;
  dictation_result(NULL, 0, "hello", NULL); config(true, 2);
  outbox_busy = false; outbox_sent(NULL, NULL); assert(commands == 0);

  // Retry startup if the phone was initially unavailable for dictation creation.
  reset(); session_available = false; start_automatic(NULL); assert(starts == 0);
  session_available = true; config(true, 1); assert(s_start_timer);
  start_automatic(NULL); assert(starts == 1 && s_listening);
  return 0;
}
