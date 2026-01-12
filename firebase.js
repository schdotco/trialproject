import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-database.js";

// 🔐 Firebase Configuration
export const firebaseConfig = {
  apiKey: "AIzaSyBk57WWCAV9PbUQBb_bj7mPtl09oNz7WnA",
  authDomain: "schesakra.firebaseapp.com",
  databaseURL: "https://schesakra-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "schesakra",
  storageBucket: "schesakra.appspot.com",
  messagingSenderId: "672537227977",
  appId: "1:672537227977:web:88b24f905c86eba7c05318"
};

// 🚀 Init Firebase
export const app = initializeApp(firebaseConfig);

// 📦 Firestore (UNTUK DATA AGREGAT DASHBOARD)
export const db = getFirestore(app);

// 🔁 Realtime Database (OPSIONAL)
export const rtdb = getDatabase(app);

// 🔑 Authentication (UNTUK LOGIN ADMIN)
export const auth = getAuth(app);
