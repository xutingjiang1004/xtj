/**
 * System media_type markers stored in the posts table.
 * Centralized so feed filters, admin lists, stats, and AI modules stay in sync.
 */
'use strict';

const REPORT_MARKER = '__report__';
const DM_MARKER = '__dm__';
const AUTH_MARKER = '__auth__';
const VISIT_MARKER = '__visit__';
const ATTACK_MARKER = '__attack__';
const ADMIN_AUTH_MARKER = '__admin_auth__';
const ADMIN_META_MARKER = '__admin_meta__';
const USER_INFO_MARKER = '__user_info__';
const USER_VISIT_MARKER = '__user_visit__';
const POST_VIEW_MARKER = '__post_view__';
const LOGIN_EVENT_MARKER = '__login_event__';
const USER_BEHAVIOR_MARKER = '__user_behavior__';
const SECURITY_ALERT_MARKER = '__security_alert__';
const AUDIT_LOG_MARKER = '__admin_audit__';
const CLIENT_ERROR_MARKER = '__client_error__';
// Cross-device announcement read state
const ANN_READ_MARKER = '__ann_read__';
// Mail / recipient history
const EMAIL_SENT_MARKER = '__email_sent__';
const EMAIL_RECIPIENT_MARKER = '__email_recipient_history__';

// AI agent markers (must stay excluded from public feed / stats / admin lists)
const AI_AGENT_PROFILE_MARKER = '__ai_agent_profile__';
const AI_AGENT_MESSAGE_MARKER = '__ai_agent_msg__';
const AI_AGENT_CONFIG_MARKER = '__ai_agent_config__';
const AI_AGENT_CONV_SUMMARY_MARKER = '**ai_agent_conv_summary**';
// Retired module marker — keep filtering to prevent old data leaking into feeds
const AI_ENGLISH_LEARNING_MARKER = '__ai_english_learning__';
const REVOKED_TOKEN_MARKER = '__revoked_token__';

module.exports = {
  REPORT_MARKER,
  DM_MARKER,
  AUTH_MARKER,
  VISIT_MARKER,
  ATTACK_MARKER,
  ADMIN_AUTH_MARKER,
  ADMIN_META_MARKER,
  USER_INFO_MARKER,
  USER_VISIT_MARKER,
  POST_VIEW_MARKER,
  LOGIN_EVENT_MARKER,
  USER_BEHAVIOR_MARKER,
  SECURITY_ALERT_MARKER,
  AUDIT_LOG_MARKER,
  CLIENT_ERROR_MARKER,
  ANN_READ_MARKER,
  EMAIL_SENT_MARKER,
  EMAIL_RECIPIENT_MARKER,
  AI_AGENT_PROFILE_MARKER,
  AI_AGENT_MESSAGE_MARKER,
  AI_AGENT_CONFIG_MARKER,
  AI_AGENT_CONV_SUMMARY_MARKER,
  AI_ENGLISH_LEARNING_MARKER,
  REVOKED_TOKEN_MARKER
};
