// Firestore data-access layer. Every path is scoped under users/{uid} —
// security rules enforce that a user can only touch their own uid subtree.
import { db } from './firebase.js';
import {
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc,
  getDocs, getDoc, query, orderBy, where, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const col = (uid, name) => collection(db, 'users', uid, name);
const ref = (uid, name, id) => doc(db, 'users', uid, name, id);

// ── Issue types ───────────────────────────────────────────────
export async function listIssueTypes(uid) {
  const snap = await getDocs(query(col(uid, 'issueTypes'), orderBy('createdAt')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export function createIssueType(uid, { name, emoji, color, fields, sourceGlobalId = null }) {
  return addDoc(col(uid, 'issueTypes'), {
    name, emoji: emoji || '📌', color: color || '#60a5fa', fields: fields || [],
    sourceGlobalId,
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
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export function createGlobalIssueType(createdByUid, { name, emoji, color, fields }) {
  return addDoc(collection(db, 'globalIssueTypes'), {
    name, emoji: emoji || '📌', color: color || '#60a5fa', fields: fields || [],
    createdBy: createdByUid, createdAt: serverTimestamp()
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
  const constraints = [orderBy('startAt', 'desc')];
  if (issueTypeId) constraints.unshift(where('issueTypeId', '==', issueTypeId));
  const snap = await getDocs(query(col(uid, 'entries'), ...constraints));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export function createEntry(uid, {
  issueTypeId, startAt, severity, customFieldValues = {}, comments = []
}) {
  return addDoc(col(uid, 'entries'), {
    issueTypeId,
    startAt,
    status: 'open',
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
