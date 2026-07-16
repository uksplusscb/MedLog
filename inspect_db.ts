import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, getDoc } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf-8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function inspect() {
  try {
    console.log("=== INSPECTING VISITS ===");
    const visitsSnap = await getDocs(collection(db, 'visits'));
    console.log("Total visits in database:", visitsSnap.size);
    if (visitsSnap.size > 0) {
      const dates = visitsSnap.docs.map(d => d.data().date);
      console.log("Sample dates:", dates.slice(0, 10));
    }

    console.log("\n=== INSPECTING SUMMARY ===");
    const summarySnap = await getDocs(collection(db, 'summary'));
    console.log("Total summaries in database:", summarySnap.size);
    summarySnap.forEach(d => {
      console.log(`Document ID: ${d.id}`, JSON.stringify(d.data()));
    });
  } catch (err) {
    console.error("Error inspecting:", err);
  }
}

inspect();
