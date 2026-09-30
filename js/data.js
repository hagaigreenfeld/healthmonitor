// Firestore data-access layer. Every path is scoped under users/{uid} —
// security rules enforce that a user can only touch their own uid subtree.
import { db } from './firebase.js';
import {
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc,
  getDocs, getDoc, query, orderBy, where, serverTimestamp, collectionGroup
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const col = (uid, name) => collection(db, 'users', uid, name);
const ref = (uid, name, id) => doc(db, 'users', uid, name, id);

// ── Accounts (admin-only: rules allow admins to read every users/{uid}) ──
export async function listUsers() {
  const snap = await getDocs(collection(db, 'users'));
  return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
}

// ── Profile (optional details on the user's own users/{uid} doc) ──
export async function getProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  const d = snap.exists() ? snap.data() : {};
  return { birthDate: d.birthDate || '', weightKg: d.weightKg ?? '', gender: d.gender || '' };
}

export function saveProfile(uid, { birthDate, weightKg, gender }) {
  return setDoc(doc(db, 'users', uid), {
    birthDate: birthDate || null,
    weightKg: weightKg === '' || weightKg == null ? null : Number(weightKg),
    gender: gender || null,
    profileUpdatedAt: serverTimestamp()
  }, { merge: true });
}

// ── Sharing ───────────────────────────────────────────────────
// users/{owner}/shares/{granteeEmail}: { email, role: 'viewer'|'editor',
// scope: 'all'|'types', typeIds, ownerUid, ownerName, ownerEmail }.
// Security rules key off this doc, so a grantee whose scope is 'types' can
// only read those issue types and their entries: queries must therefore be
// issued per allowed type (a broad query would be rejected as a whole).
const typeRestrictions = new Map(); // uid -> string[] | undefined
export function setTypeRestriction(uid, typeIds) {
  if (typeIds) typeRestrictions.set(uid, typeIds); else typeRestrictions.delete(uid);
}

export const shareKey = email => email.trim().toLowerCase();

export async function listShares(ownerUid) {
  const snap = await getDocs(col(ownerUid, 'shares'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export function saveShare(owner, { email, role, scope, typeIds }) {
  const key = shareKey(email);
  return setDoc(ref(owner.uid, 'shares', key), {
    email: key, role, scope, typeIds: scope === 'types' ? typeIds : [],
    ownerUid: owner.uid, ownerName: owner.name || '', ownerEmail: owner.email || '',
    updatedAt: serverTimestamp()
  });
}

export function deleteShare(ownerUid, key) {
  return deleteDoc(ref(ownerUid, 'shares', key));
}

export async function listSharedWithMe(email) {
  const snap = await getDocs(query(collectionGroup(db, 'shares'), where('email', '==', shareKey(email))));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Global questions (admin-managed library, reusable across issue types) ──
// An issue type field with a questionId is a live reference: its definition
// (label/type/options/scale…) comes from globalQuestions/{questionId}, while the
// value is stored on entries under the field's own id ('q_<questionId>'), so the
// same question stays comparable across types. The copy kept on the type is only
// a fallback for when the question is deleted or cannot be loaded.
const QUESTION_KEYS = ['label', 'type', 'unit', 'options', 'min', 'max', 'labelMode', 'labels'];
let questionCache = [];

function resolveFields(type) {
  if (!type.fields?.some(f => f.questionId)) return type;
  return {
    ...type,
    fields: type.fields.map(f => {
      const q = f.questionId && questionCache.find(x => x.id === f.questionId);
      if (!q) return f;
      const out = { ...f };
      QUESTION_KEYS.forEach(k => { if (q[k] !== undefined) out[k] = q[k]; });
      return out;
    })
  };
}

export async function listGlobalQuestions() {
  try {
    const snap = await getDocs(query(collection(db, 'globalQuestions'), orderBy('createdAt')));
    questionCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn('globalQuestions unavailable:', err.code || err);
    questionCache = [];
  }
  return questionCache;
}

const pickQuestion = q => Object.fromEntries(QUESTION_KEYS.filter(k => q[k] !== undefined).map(k => [k, q[k]]));

export function createGlobalQuestion(createdByUid, q) {
  return addDoc(collection(db, 'globalQuestions'), { ...pickQuestion(q), createdBy: createdByUid, createdAt: serverTimestamp() });
}

export function updateGlobalQuestion(questionId, q) {
  return updateDoc(doc(db, 'globalQuestions', questionId), pickQuestion(q));
}

export function deleteGlobalQuestion(questionId) {
  return deleteDoc(doc(db, 'globalQuestions', questionId));
}

// ── Issue types ───────────────────────────────────────────────
export async function listIssueTypes(uid) {
  const only = typeRestrictions.get(uid);
  if (only) {
    const docs = await Promise.all(only.map(id => getDoc(ref(uid, 'issueTypes', id))));
    return docs.filter(d => d.exists()).map(d => resolveFields({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
  }
  const snap = await getDocs(query(col(uid, 'issueTypes'), orderBy('createdAt')));
  return snap.docs.map(d => resolveFields({ id: d.id, ...d.data() }));
}

// syncedFieldIds: catalog field ids already offered to this copy, so a field the
// user later removes from their copy is not re-added by the catalog sync.
export function createIssueType(uid, { name, emoji, color, fields, sourceGlobalId = null, entryMode = 'episodic', trackSeverity = true, syncedFieldIds = null }) {
  return addDoc(col(uid, 'issueTypes'), {
    name, emoji: emoji || '📌', color: color || '#60a5fa', fields: fields || [],
    sourceGlobalId, entryMode, trackSeverity, syncedFieldIds,
    createdAt: serverTimestamp()
  });
}

export function updateIssueType(uid, issueTypeId, patch) {
  return updateDoc(ref(uid, 'issueTypes', issueTypeId), patch);
}

export function deleteIssueType(uid, issueTypeId) {
  return deleteDoc(ref(uid, 'issueTypes', issueTypeId));
}

// ── Global issue types (admin-managed, visible to every user) ──
export async function listGlobalIssueTypes() {
  const snap = await getDocs(query(collection(db, 'globalIssueTypes'), orderBy('createdAt')));
  return snap.docs.map(d => resolveFields({ id: d.id, ...d.data() }));
}

// promotedFrom: { uid, issueTypeId } when an admin copies a user's manual type into the catalog.
export function createGlobalIssueType(createdByUid, { name, emoji, color, fields, entryMode = 'episodic', trackSeverity = true, promotedFrom = null }) {
  return addDoc(collection(db, 'globalIssueTypes'), {
    name, emoji: emoji || '📌', color: color || '#60a5fa', fields: fields || [],
    entryMode, trackSeverity, promotedFrom, createdBy: createdByUid, createdAt: serverTimestamp()
  });
}

export function updateGlobalIssueType(issueTypeId, patch) {
  return updateDoc(doc(db, 'globalIssueTypes', issueTypeId), patch);
}

export function deleteGlobalIssueType(issueTypeId) {
  return deleteDoc(doc(db, 'globalIssueTypes', issueTypeId));
}

// ── Entries (the actual health records) ──────────────────────
export async function listEntries(uid, { issueTypeId } = {}) {
  const only = typeRestrictions.get(uid);
  if (only && !issueTypeId) {
    const lists = await Promise.all(only.map(id => listEntries(uid, { issueTypeId: id })));
    const ms = e => (e.startAt?.toMillis ? e.startAt.toMillis() : new Date(e.startAt).getTime());
    return lists.flat().sort((a, b) => ms(b) - ms(a));
  }
  const constraints = [orderBy('startAt', 'desc')];
  if (issueTypeId) constraints.unshift(where('issueTypeId', '==', issueTypeId));
  const snap = await getDocs(query(col(uid, 'entries'), ...constraints));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export function createEntry(uid, {
  issueTypeId, startAt, severity, customFieldValues = {}, comments = [], status = 'open'
}) {
  return addDoc(col(uid, 'entries'), {
    issueTypeId,
    startAt,
    status,
    endAt: null,
    durationHours: null,
    severity,
    customFieldValues,
    comments,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export function updateEntry(uid, entryId, patch) {
  return updateDoc(ref(uid, 'entries', entryId), { ...patch, updatedAt: serverTimestamp() });
}

export function closeEntry(uid, entryId, endAt) {
  return getDoc(ref(uid, 'entries', entryId)).then(snap => {
    const data = snap.data();
    const durationHours = data?.startAt
      ? (endAt.toDate ? endAt.toDate() : endAt).getTime() / 3600000
        - (data.startAt.toDate ? data.startAt.toDate() : data.startAt).getTime() / 3600000
      : null;
    return updateEntry(uid, entryId, { status: 'closed', endAt, durationHours });
  });
}

export function addComment(uid, entryId, text) {
  return getDoc(ref(uid, 'entries', entryId)).then(snap => {
    const comments = snap.data()?.comments || [];
    comments.push({ text, createdAt: new Date().toISOString() });
    return updateEntry(uid, entryId, { comments });
  });
}

export function deleteEntry(uid, entryId) {
  return deleteDoc(ref(uid, 'entries', entryId));
}

// ── Doctor visits ─────────────────────────────────────────────
export async function listVisits(uid) {
  const snap = await getDocs(query(col(uid, 'visits'), orderBy('date', 'desc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export function createVisit(uid, { doctorName, date, summary, attachments = [] }) {
  return addDoc(col(uid, 'visits'), {
    doctorName, date, summary, attachments, createdAt: serverTimestamp()
  });
}

export function deleteVisit(uid, visitId) {
  return deleteDoc(ref(uid, 'visits', visitId));
}

// ── Todos ─────────────────────────────────────────────────────
export async function listTodos(uid) {
  const snap = await getDocs(query(col(uid, 'todos'), orderBy('createdAt', 'desc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export function createTodo(uid, text) {
  return addDoc(col(uid, 'todos'), { text, done: false, createdAt: serverTimestamp() });
}

export function updateTodo(uid, todoId, patch) {
  return updateDoc(ref(uid, 'todos', todoId), patch);
}

export function deleteTodo(uid, todoId) {
  return deleteDoc(ref(uid, 'todos', todoId));
}
