// Firebase init — shared across all pages/modules.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyCcB7XORC8oONKzCoLzkYyzDD3oNMon4Tc",
  authDomain: "healthmonitor-405cc.firebaseapp.com",
  projectId: "healthmonitor-405cc",
  storageBucket: "healthmonitor-405cc.firebasestorage.app",
  messagingSenderId: "705492808533",
  appId: "1:705492808533:web:8f5bd32c55626434ec75dc"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
