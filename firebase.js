<script type="module">
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyBk57WWCAV9PbUQBb_bj7mPtl09oNz7WnA",
  authDomain: "schesakra.firebaseapp.com",
  projectId: "schesakra"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
</script>
