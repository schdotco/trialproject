import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-database.js";

// 🔐 Firebase Configuration
export const firebaseConfig = {
  apiKey: "AIzaSyCBCkTIUvI4kXbkb7fj_Wj_F_Kbl6nQkjc",
  authDomain: "dashboardciklam.firebaseapp.com",
  projectId: "dashboardciklam",
  storageBucket: "dashboardciklam.firebasestorage.app",
  messagingSenderId: "1025674860242",
  appId: "1:1025674860242:web:32856521a7f64b92db7f0b",
  measurementId: "G-PBDYZM1RHE"
};

// 🚀 Init Firebase
export const app = initializeApp(firebaseConfig);

// 📦 Firestore (UNTUK DATA AGREGAT DASHBOARD)
export const db = getFirestore(app);

// 🔁 Realtime Database (OPSIONAL)
export const rtdb = getDatabase(app);

// 🔑 Authentication (UNTUK LOGIN ADMIN)
export const auth = getAuth(app);
