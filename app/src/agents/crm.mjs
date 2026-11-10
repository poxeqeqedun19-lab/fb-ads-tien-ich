// Agent 9 — CRM Agent, INTAKE ONLY (Phase 3).
// Full CRM (Module F) is Phase 6 and is NOT built here. This module
// does exactly one Phase 3 job (DEVELOPMENT_ROADMAP.md §7, T3.5):
// create a lead record + follow-up task from a conversation that
// shows buying intent. It is internal only: it sends no message to
// any customer (Agent 9 may never call send_message; any customer
// message goes through Agent 4 and that agent's approval gate).
//
// Rules (AI_AGENT_ARCHITECTURE.md § Agent 9; DATABASE_DESIGN.md
// §3.10):
//   - Lead data comes ONLY from what the caller passes in (name /
//     contact / notes as entered by the owner/team) or from the
//     conversation itself (source channel, source_conversation_id).
//     Name/contact are NEVER scraped from a Meta profile and NEVER
//     invented (DATABASE_DESIGN §3.10 validation: contact details
//     are stored only when the customer provided them or the user
//     entered them with a lawful basis).
//   - L1 autonomy: internal CRM updates and task creation need no
//     per-item approval, but every change is logged (audit) and
//     reversible (soft delete exists on the table; this module does
//     not delete).
//   - NO merge, NO delete here: merging or deleting a lead/contact
//     record requires explicit Owner/Admin approval (Agent 9 gate).
//     A duplicate suggestion is never auto-merged — and no duplicate
//     detection is attempted in this intake-only module.
//   - No lead score is computed: scoring inputs are owner-provided
//     rules that do not exist yet in Phase 3, and Agent 9's own
//     fallback is "insufficient data" rather than a guessed score.
//     Lead status starts at 'new' (DATABASE_DESIGN §3.10 default).
//   - The follow-up task carries NO due date: a date is set only by
//     a human or by an owner-approved rule, never invented.
import { appendAudit } from '../audit.mjs';
import { newId, nowIso } from '../db.mjs';

// Phase 3 only: a lead can come only from a Messenger or Instagram
// DM conversation (the only channels in this phase). DATABASE_DESIGN
// §3.10 lists a wider source enum (whatsapp, comment, ad, manual,
// form); those values arrive with their phases, not here.
const LEAD_SOURCES = Object.freeze(['messenger', 'instagram_dm']);

function validation(message) {
  return Object.assign(new Error(message), { code: 'validation_error' });
}

function notFound(message) {
  return Object.assign(new Error(message), { code: 'not_found' });
}

/**
 * Create a lead from a conversation (Agent 9 intake, Phase 3).
 *
 * @param {object} db
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {string} opts.conversationId
 * @param {string} opts.createdBy - existing tenant user; becomes the
 *   lead's owner_id and the follow-up task's assignee.
 * @param {string} [opts.name] - only as passed in; never scraped/invented.
 * @param {string} [opts.contact] - only as passed in (phone/email the
 *   customer provided or the user entered); never scraped/invented.
 * @param {string} [opts.notes] - user-written notes only.
 * @returns {{ lead, task }} — the created lead row and follow-up task
 *   row. Links conversation.lead_id. Sends no message.
 */
export function createLeadFromConversation(db, { tenantId, conversationId, createdBy, name = null, contact = null, notes = null }) {
  if (!tenantId || !conversationId) throw validation('createLeadFromConversation requires tenantId and conversationId');
  if (!createdBy) throw validation('createLeadFromConversation requires createdBy');
  const conversation = db.prepare('SELECT * FROM conversations WHERE id = ? AND tenant_id = ?').get(conversationId, tenantId);
  if (!conversation) throw notFound('Conversation not found');
  const creator = db.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').get(createdBy, tenantId);
  if (!creator) throw notFound('Creating user not found');
  if (name !== null && typeof name !== 'string') throw validation('Lead name must be a string');
  if (contact !== null && typeof contact !== 'string') throw validation('Lead contact must be a string');
  if (notes !== null && typeof notes !== 'string') throw validation('Lead notes must be a string');

  // Source = the conversation's channel (messenger | instagram_dm —
  // both are valid lead sources per DATABASE_DESIGN §3.10). A channel
  // outside the lead-source enum cannot produce a lead.
  const source = conversation.channel;
  if (!LEAD_SOURCES.includes(source)) {
    throw validation(`Conversation channel '${source}' is not a lead source`);
  }

  const now = nowIso();
  const leadId = newId();
  // NOTE: the live leads table (src/db.mjs, other Phase 3 stream) has
  // no source_comment_id / source_campaign_id columns — DATABASE_DESIGN
  // §3.10 lists them, but the implemented table omits them. This
  // insert lists only columns that exist in the live table.
  db.prepare(
    `INSERT INTO leads (id, tenant_id, source, source_conversation_id, name, contact, status, owner_id, notes, deleted_at, created_at, updated_at, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?, NULL, ?, ?, ?, NULL)`,
  ).run(leadId, tenantId, source, conversationId, name, contact, createdBy, notes, now, now, createdBy);

  const taskId = newId();
  const participant = conversation.participant_name ? ` ${conversation.participant_name}` : '';
  db.prepare(
    `INSERT INTO tasks (id, tenant_id, type, title, details, conversation_id, lead_id, assigned_to, status, created_by, deleted_at, created_at, updated_at)
     VALUES (?, ?, 'lead_follow_up', ?, ?, ?, ?, ?, 'open', ?, NULL, ?, ?)`,
  ).run(
    taskId,
    tenantId,
    `Follow up lead from${participant} (${source})`,
    notes
      ? `Lead created from conversation ${conversationId}. Notes: ${notes}`
      : `Lead created from conversation ${conversationId}. No notes provided; follow up with the customer through the inbox (Agent 4 approval gate applies to any reply).`,
    conversationId,
    leadId,
    createdBy,
    createdBy,
    now,
    now,
  );

  db.prepare(`UPDATE conversations SET lead_id = ?, updated_at = ? WHERE id = ?`).run(leadId, now, conversationId);

  appendAudit(db, {
    tenantId,
    actorId: createdBy,
    actorType: 'user',
    action: 'lead.created',
    targetType: 'lead',
    targetId: leadId,
    details: { leadId, source, sourceConversationId: conversationId, taskId },
  });
  appendAudit(db, {
    tenantId,
    actorId: createdBy,
    actorType: 'user',
    action: 'task.created',
    targetType: 'task',
    targetId: taskId,
    details: { taskId, type: 'lead_follow_up', leadId, conversationId, assignedTo: createdBy },
  });

  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  return { lead, task };
}

export default { createLeadFromConversation };
