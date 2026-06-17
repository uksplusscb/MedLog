import React, { useState, useEffect } from 'react';
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc,
  deleteDoc, 
  doc, 
  query, 
  orderBy,
  setDoc
} from 'firebase/firestore';
import { db, runWithRetry, handleFirestoreError, OperationType } from '../lib/firebase';
import { TeacherContact } from '../types';
import { 
  Plus, 
  Trash2, 
  Edit2,
  Phone, 
  MessageSquare, 
  Users, 
  Loader2, 
  Search,
  X,
  RefreshCw,
  CheckCircle2
} from 'lucide-react';
import { getCachedDriveToken } from '../lib/drive';
import { fetchMasterDataFromSheets } from '../lib/sheets';

export default function TeacherContacts() {
  const [contacts, setContacts] = useState<TeacherContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newContact, setNewContact] = useState({ name: '', whatsapp: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorStatus, setErrorStatus] = useState<string | null>(null);
  const [isSyncingSheets, setIsSyncingSheets] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const fetchAndMergeSheetsTeachers = async (silent = false) => {
    const token = getCachedDriveToken();
    if (!silent) {
      setIsSyncingSheets(true);
      setSyncMessage(null);
    }
    try {
      const sheetTeachers = await fetchMasterDataFromSheets(token, 'teachers');
      if (sheetTeachers && sheetTeachers.length > 0) {
        const writePromises = sheetTeachers.map(teacher => {
          if (teacher.id && teacher.name) {
            return setDoc(doc(db, 'teachers', teacher.id), {
              name: teacher.name,
              whatsapp: String(teacher.whatsapp || '').replace(/\D/g, ''),
              role: teacher.role || '',
              grade: teacher.grade || '',
              gender: teacher.gender || ''
            }, { merge: true });
          }
          return Promise.resolve();
        });
        await Promise.all(writePromises);
        
        // Save to cache
        localStorage.setItem('uks_cache_teachers', JSON.stringify(sheetTeachers));
        if (!silent) {
          setSyncMessage({
            type: 'success',
            text: `Berhasil tersinkronisasi! ${sheetTeachers.length} data guru diimpor dari Google Sheets.`
          });
          setTimeout(() => setSyncMessage(null), 3500);
        }
      } else if (!silent) {
        setSyncMessage({
          type: 'error',
          text: 'Tidak ada data kontak guru ditemukan di Google Sheets Anda.'
        });
      }
    } catch (err: any) {
      console.error("Gagal menyinkronkan data guru dari Google Sheets:", err);
      if (!silent) {
        setSyncMessage({
          type: 'error',
          text: `Gagal sinkronisasi: ${err.message || 'Periksa koneksi Google Drive Anda.'}`
        });
      }
    } finally {
      if (!silent) {
        setIsSyncingSheets(false);
      }
    }
  };

  useEffect(() => {
    let unsubscribe = () => {};
    
    const initializeListener = () => {
      try {
        const teachersRef = collection(db, 'teachers');
        const q = query(teachersRef, orderBy('name', 'asc'));
        
        unsubscribe = onSnapshot(q, 
          (snapshot) => {
            try {
              const data = snapshot.docs.map(doc => {
                const docData = doc.data() || {};
                return {
                  id: doc.id,
                  name: String(docData.name || 'Tanpa Nama'),
                  whatsapp: String(docData.whatsapp || '')
                } as TeacherContact;
              });
              setContacts(data);
              setLoading(false);
            } catch (err) {
              console.error("Error processing snapshot data:", err);
              setLoading(false);
            }
          },
          (error) => {
            console.error("Firestore onSnapshot error:", error);
            // Don't crash, just stop loading
            setLoading(false);
            if (error.code === 'permission-denied') {
               setErrorStatus('Akses ditolak. Pastikan Anda sudah login.');
            }
          }
        );
      } catch (err) {
        console.error("Error initializing Firestore listener:", err);
        setLoading(false);
      }
    };

    initializeListener();
    // Silent fetch of teachers from Google Sheets on mount
    fetchAndMergeSheetsTeachers(true);
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newContact.name.trim();
    const whatsapp = newContact.whatsapp.trim();
    
    if (!name || !whatsapp) return;

    setIsSubmitting(true);
    setErrorStatus(null);
    try {
      if (editingId) {
        await runWithRetry(() => updateDoc(doc(db, 'teachers', editingId), {
          name,
          whatsapp: whatsapp.replace(/\D/g, '')
        }));
        try {
          alert('Data berhasil diperbarui');
        } catch (_) {}
      } else {
        await runWithRetry(() => addDoc(collection(db, 'teachers'), {
          name,
          whatsapp: whatsapp.replace(/\D/g, '') // Remove non-numeric
        }));
        try {
          alert('Data berhasil disimpan');
        } catch (_) {}
      }
      setNewContact({ name: '', whatsapp: '' });
      setShowAddForm(false);
      setEditingId(null);
    } catch (error: any) {
      console.error("Error saving contact:", error);
      handleFirestoreError(error, editingId ? OperationType.UPDATE : OperationType.CREATE, 'teachers');
      setErrorStatus(`Gagal: ${error.message || 'Coba lagi nanti'}`);
      try {
        alert('Gagal menyimpan data: ' + (error.message || 'Error tidak dikenal'));
      } catch (_) {}
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditClick = (contact: TeacherContact) => {
    setNewContact({ name: contact.name, whatsapp: contact.whatsapp });
    setEditingId(contact.id || null);
    setShowAddForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelEdit = () => {
    setShowAddForm(false);
    setEditingId(null);
    setNewContact({ name: '', whatsapp: '' });
    setErrorStatus(null);
  };

  const handleDeleteContact = async (id: string, name: string) => {
    // Avoid native confirm as it might crash in some embedded environments
    // For now, we'll just log or use a simple flag if confirm is blocked
    try {
      // Simple confirmation that is safer than native confirm in some contexts
      // but if the user wants it, we can keep it with a try-catch for the confirm call itself
      let shouldDelete = false;
      try {
        shouldDelete = window.confirm(`Hapus kontak ${name}?`);
      } catch (e) {
        // If confirm is blocked/not available, assume yes for now or handle gracefully
        shouldDelete = true; 
      }

      if (shouldDelete) {
        await deleteDoc(doc(db, 'teachers', id));
      }
    } catch (error) {
      console.error("Error deleting contact:", error);
    }
  };

  const filteredContacts = (contacts || []).filter(c => {
    if (!c) return false;
    const nameMatch = (c.name || '').toLowerCase().includes(searchTerm.toLowerCase());
    const phoneMatch = (c.whatsapp || '').includes(searchTerm);
    return nameMatch || phoneMatch;
  });

  const openWhatsApp = (number: string) => {
    if (!number) return;
    try {
      const cleanNumber = number.replace(/\D/g, '');
      const formattedNumber = cleanNumber.startsWith('0') ? '62' + cleanNumber.slice(1) : (cleanNumber.startsWith('62') ? cleanNumber : '62' + cleanNumber);
      window.open(`https://wa.me/${formattedNumber}`, '_blank');
    } catch (e) {
      console.error("Error opening WhatsApp:", e);
    }
  };

  return (
    <div className="space-y-6">
      {syncMessage && (
        <div className={`p-3.5 rounded border text-[10px] font-bold uppercase tracking-wider flex items-center gap-2.5 transition-all shadow-sm ${
          syncMessage.type === 'success' 
            ? 'bg-emerald-50 text-emerald-850 border-emerald-200 animate-pulse' 
            : 'bg-rose-50 text-rose-800 border-rose-200'
        }`}>
          {syncMessage.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <X className="w-4 h-4 text-rose-500" />}
          <span>{syncMessage.text}</span>
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-center justify-between bg-white p-4 rounded-lg border border-slate-200 shadow-sm gap-4">
        <div className="flex items-center gap-4">
          <div className="h-8 w-1 bg-green-500 rounded-full" />
          <div className="flex flex-col">
            <h2 className="text-sm font-bold text-slate-800 tracking-tight uppercase">Kontak Wali & Pembina</h2>
            <p className="text-[10px] text-slate-400 font-medium tracking-widest uppercase">Kontak Darurat & Koordinasi</p>
          </div>
        </div>
        
        <div className="flex flex-1 max-w-xl items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input 
              type="text" 
              placeholder="CARI NAMA ATAU NO WA..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-1.5 bg-slate-50 border border-slate-200 rounded text-[10px] font-bold uppercase tracking-widest focus:outline-none focus:border-green-300 transition-colors"
            />
          </div>

          <button
            onClick={() => fetchAndMergeSheetsTeachers(false)}
            disabled={isSyncingSheets}
            className="bg-violet-600 hover:bg-violet-750 text-white px-3.5 py-1.5 rounded text-[10px] font-bold transition-all shadow-sm flex items-center gap-2 uppercase tracking-widest flex-shrink-0 disabled:opacity-50"
            title="SINKRON DATA DARI GOOGLE SHEET "
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncingSheets ? 'animate-spin' : ''}`} />
            {isSyncingSheets ? 'SINKRON...' : 'SINKRON GURU'}
          </button>

          <button
            onClick={() => showAddForm ? cancelEdit() : setShowAddForm(true)}
            className="bg-slate-900 hover:bg-slate-800 text-white px-4 py-1.5 rounded text-[10px] font-bold transition-all shadow-sm flex items-center gap-2 uppercase tracking-widest flex-shrink-0"
          >
            {showAddForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            {showAddForm ? 'BATAL' : 'TAMBAH KONTAK'}
          </button>
        </div>
      </div>

      {showAddForm && (
        <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm mb-6">
          <div className="flex items-center gap-2 mb-4 pb-4 border-b border-slate-50">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em]">{editingId ? 'Mode Edit Kontak' : 'Tambah Kontak Baru'}</h3>
          </div>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">Nama Lengkap</label>
              <input
                type="text"
                required
                value={newContact.name}
                onChange={(e) => setNewContact({ ...newContact, name: e.target.value })}
                placeholder="Simpan nama di sini..."
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded text-[11px] font-medium focus:ring-1 focus:ring-green-500 outline-none"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">Nomor WhatsApp</label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
                <input
                  type="text"
                  required
                  value={newContact.whatsapp}
                  onChange={(e) => setNewContact({ ...newContact, whatsapp: e.target.value })}
                  placeholder="Contoh: 08123456789"
                  className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded text-[11px] font-medium focus:ring-1 focus:ring-green-500 outline-none"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 bg-green-600 hover:bg-green-700 text-white h-[38px] rounded text-[10px] font-bold transition-all shadow-sm flex items-center justify-center gap-2 uppercase tracking-widest disabled:opacity-50"
              >
                {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (editingId ? 'UPDATE DATA' : 'SIMPAN DATA')}
              </button>
              {editingId && (
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-500 w-10 h-[38px] rounded flex items-center justify-center transition-all"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </form>
          {errorStatus && (
            <div className="mt-4 p-3 bg-red-50 border border-red-100 rounded text-[10px] font-bold text-red-600 uppercase">
              {errorStatus}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="w-10 h-10 animate-spin text-slate-200" />
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-300">Loading Cloud Database...</p>
        </div>
      ) : filteredContacts.length === 0 ? (
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-20 text-center">
          <div className="bg-slate-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
            <Users className="w-8 h-8 text-slate-200" />
          </div>
          <h3 className="text-sm font-bold text-slate-400 uppercase">No contacts found</h3>
          <p className="text-[10px] text-slate-300 mt-1 uppercase font-medium">Add a new teacher contact to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredContacts.map((contact) => (
            <div 
              key={contact.id} 
              className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden flex flex-col group hover:border-green-400 transition-all"
            >
              <div className="p-4 flex-1">
                <div className="flex items-start justify-between mb-3">
                  <div className="bg-slate-100 w-10 h-10 rounded flex items-center justify-center">
                    <Users className="w-5 h-5 text-slate-400" />
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleEditClick(contact)}
                      className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-300 hover:text-blue-500 transition-all"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteContact(contact.id!, contact.name)}
                      className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-300 hover:text-red-500 transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                
                <h3 className="font-bold text-slate-800 text-[11px] uppercase truncate">{contact.name}</h3>
                <div className="flex items-center gap-2 mt-2">
                  <div className="bg-green-50 text-green-600 p-0.5 rounded">
                    <MessageSquare className="w-3 h-3" />
                  </div>
                  <span className="text-[10px] font-mono font-medium text-slate-500">
                    {contact.whatsapp}
                  </span>
                </div>
              </div>

              <button
                onClick={() => openWhatsApp(contact.whatsapp)}
                className="w-full bg-slate-50 hover:bg-green-600 hover:text-white py-2.5 text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all border-t border-slate-100"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                Hubungi via WA
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
