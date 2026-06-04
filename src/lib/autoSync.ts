import { collection, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import { getCachedDriveToken } from './drive';
import { addOrUpdateMasterItemInSheets, deleteMasterItemInSheets } from './sheets';

export function setupMasterDatabaseAutoSync() {
  const collections: ('students' | 'medicines' | 'diagnoses')[] = ['students', 'medicines', 'diagnoses'];

  console.log('[AutoSync] Initializing automatic synchronization of master database collections...');

  const unsubscribes = collections.map((colName) => {
    let isInitial = true;
    
    return onSnapshot(collection(db, colName), (snapshot) => {
      if (isInitial) {
        // Skip initial documents loaded from Firestore so we don't trigger mass updates on load
        isInitial = false;
        return;
      }

      snapshot.docChanges().forEach(async (change) => {
        const token = getCachedDriveToken();
        if (!token) {
          console.log(`[AutoSync] skipped for ${colName}: Google API OAuth token not available.`);
          return;
        }

        const data = change.doc.data();
        const itemId = change.doc.id;
        const item = { id: itemId, ...data };

        try {
          if (change.type === 'added') {
            console.log(`[AutoSync] Detecting new item. Adding to Google Sheets: ${colName}/${itemId}`);
            await addOrUpdateMasterItemInSheets(token, colName, item, false);
          } else if (change.type === 'modified') {
            console.log(`[AutoSync] Detecting modified item. Updating in Google Sheets: ${colName}/${itemId}`);
            await addOrUpdateMasterItemInSheets(token, colName, item, true);
          } else if (change.type === 'removed') {
            console.log(`[AutoSync] Detecting removed item. Deleting from Google Sheets: ${colName}/${itemId}`);
            await deleteMasterItemInSheets(token, colName, itemId);
          }
        } catch (error) {
          console.error(`[AutoSync] Error performing operation for ${colName}/${itemId} in Sheets:`, error);
        }
      });
    }, (err) => {
      console.error(`[AutoSync] Firestore snapshot listener error for ${colName}:`, err);
    });
  });

  return () => {
    console.log('[AutoSync] Cleaning up master database auto sync listeners...');
    unsubscribes.forEach((unsub) => unsub());
  };
}
