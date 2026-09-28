import { auth, db } from './firebase.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
  updateProfile
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  doc, setDoc, serverTimestamp,
  collection, getDocs, query, limit
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const DEFAULT_ISSUE_TYPE = {
  name: 'מיגרנה',
  emoji: '🤕',
  color: '#a855f7',
  fields: [
    { id: 'water', label: 'כמות מים (כוסות)', type: 'number', unit: 'כוסות' },
    { id: 'sleep', label: 'שעות שינה', type: 'number', unit: 'שעות' },
    { id: 'nutrition', label: 'תזונה', type: 'select', options: ['רגילה', 'דילוג על ארוחה', 'לא בריאה'] }
  ]
};

export async function signUp(email, password, displayName) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (displayName) await updateProfile(cred.user, { displayName });
  await setDoc(doc(db, 'users', cred.user.uid), {
    displayName: displayName || '',
    createdAt: serverTimestamp()
  });
  await seedDefaultIssueTypeIfEmpty(cred.user.uid);
  return cred.user;
}

export async function signIn(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  await seedDefaultIssueTypeIfEmpty(cred.user.uid);
  return cred.user;
}

export function signOutUser() {
  return fbSignOut(auth);
}

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function seedDefaultIssueTypeIfEmpty(uid) {
  const q = query(collection(db, 'users', uid, 'issueTypes'), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) {
    const ref = doc(collection(db, 'users', uid, 'issueTypes'));
    await setDoc(ref, { ...DEFAULT_ISSUE_TYPE, createdAt: serverTimestamp() });
  }
}
