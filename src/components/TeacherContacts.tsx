import React, { useState, useEffect } from 'react';
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  deleteDoc, 
  doc, 
  query, 
  orderBy 
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { TeacherContact } from '../types';
import { 
  Plus, 
  Trash2, 
  Phone, 
  MessageSquare, 
  Users, 
  Loader2, 
  Search,
  X
} from 'lucide-react';
import { cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';

export default function TeacherContacts() {
  const [contacts, setContacts] = useState<TeacherContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newContact, setNewContact] = useState({ name: '', whatsapp: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorStatus, setErrorStatus] = useState<string | null>(null);

  useEffect(() => {
    let unsubscribe = () => {};
    
    try {
      const q = query(collection(db, 'teachers'), orderBy('name', 'asc'));
      unsubscribe = onSnapshot(q, 
        (snapshot) => {
          const data = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          })) as TeacherContact[];
          setContacts(data);
          setLoading(false);
        },
        (error) => {
          console.error("Snapshot error:", error);
          setLoading(false);
        }
      );
    } catch (err) {
      console.error("Error setting up listener:", err);
      setLoading(false);
    }

    return () => unsubscribe();
  }, []);

  const handleAddContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContact.name.trim() || !newContact.whatsapp.trim()) return;

    setIsSubmitting(true);
    setErrorStatus(null);
    try {
      await addDoc(collection(db, 'teachers'), {
        name: newContact.name.trim(),
        whatsapp: newContact.whatsapp.trim().replace(/\D/g, '') // Remove non-numeric
      });
      setNewContact({ name: '', whatsapp: '' });
      setShowAddForm(false);
    } catch (error) {
      console.error("Error adding contact:", error);
      setErrorStatus('Gagal menambahkan data. Coba lagi nanti.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteContact = async (id: string) => {
    if (confirm('Hapus kontak ini?')) {
      try {
        await deleteDoc(doc(db, 'teachers', id));
      } catch (error) {
        console.error("Error deleting contact:", error);
      }
    }
  };

  const filteredContacts = contacts.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    c.whatsapp.includes(searchTerm)
  );

  const openWhatsApp = (number: string) => {
    const formattedNumber = number.startsWith('0') ? '62' + number.slice(1) : number;
    window.open(`https://wa.me/${formattedNumber}`, '_blank');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between bg-white p-4 rounded-lg border border-slate-200 shadow-sm gap-4">
        <div className="flex items-center gap-4">
          <div className="h-8 w-1 bg-green-500 rounded-full" />
          <div className="flex flex-col">
            <h2 className="text-sm font-bold text-slate-800 tracking-tight uppercase">Kontak Guru & Staff</h2>
            <p className="text-[10px] text-slate-400 font-medium">MANAJEMEN NOMOR DARURAT & KOORDINASI</p>
          </div>
        </div>
        
        <div className="flex flex-1 max-w-md items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input 
              type="text" 
              placeholder="CARI NAMA ATAU WHATSAPP..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-1.5 bg-slate-50 border border-slate-200 rounded text-[10px] font-bold uppercase tracking-widest focus:outline-none focus:border-green-300 transition-colors"
            />
          </div>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="bg-slate-900 hover:bg-slate-800 text-white px-4 py-1.5 rounded text-[10px] font-bold transition-all shadow-sm flex items-center gap-2 uppercase tracking-widest flex-shrink-0"
          >
            {showAddForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            {showAddForm ? 'BATAL' : 'TAMBAH KONTAK'}
          </button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {showAddForm && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-white p-6 rounded-lg border border-slate-200 shadow-sm mb-6">
              <form onSubmit={handleAddContact} className="grid grid-cols-1 md:grid-cols-3 gap-4 h-auto items-end">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-tight">Nama Guru / Staff</label>
                  <input
                    type="text"
                    required
                    value={newContact.name}
                    onChange={(e) => setNewContact({ ...newContact, name: e.target.value })}
                    placeholder="Masukkan nama lengkap..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded text-[11px] font-medium"
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
                      className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded text-[11px] font-medium"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-green-600 hover:bg-green-700 text-white h-[38px] rounded text-[10px] font-bold transition-all shadow-sm flex items-center justify-center gap-2 uppercase tracking-widest disabled:opacity-50"
                >
                  {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'SIMPAN KONTAK'}
                </button>
              </form>
              {errorStatus && (
                <div className="mt-4 p-3 bg-red-50 border border-red-100 rounded text-[10px] font-bold text-red-600 uppercase">
                  {errorStatus}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 opacity-20">
          <Loader2 className="w-10 h-10 animate-spin text-slate-400" />
          <p className="text-[10px] font-bold uppercase tracking-widest">Sinkronisasi Database...</p>
        </div>
      ) : filteredContacts.length === 0 ? (
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-20 text-center">
          <div className="bg-slate-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
            <Users className="w-8 h-8 text-slate-300" />
          </div>
          <h3 className="text-sm font-bold text-slate-900 uppercase">Belum ada data kontak</h3>
          <p className="text-[10px] text-slate-400 mt-1 uppercase font-medium">Tambahkan kontak guru untuk mulai mendata</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredContacts.map((contact) => (
            <motion.div 
              layout
              key={contact.id} 
              className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden flex flex-col group hover:border-green-300 transition-colors"
            >
              <div className="p-4 flex-1">
                <div className="flex items-start justify-between mb-3">
                  <div className="bg-slate-50 w-10 h-10 rounded-lg flex items-center justify-center">
                    <Users className="w-5 h-5 text-slate-400" />
                  </div>
                  <button
                    onClick={() => handleDeleteContact(contact.id!)}
                    className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                
                <h3 className="font-bold text-slate-900 text-xs uppercase limit-rows-1">{contact.name}</h3>
                <div className="flex items-center gap-2 mt-2">
                  <div className="bg-green-50 text-green-600 p-1 rounded">
                    <MessageSquare className="w-3 h-3" />
                  </div>
                  <span className="text-[11px] font-mono font-medium text-slate-500 tracking-wider">
                    {contact.whatsapp}
                  </span>
                </div>
              </div>

              <button
                onClick={() => openWhatsApp(contact.whatsapp)}
                className="w-full bg-slate-50 hover:bg-green-600 hover:text-white py-2.5 px-4 text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all border-t border-slate-100 group-hover:border-green-100"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                Hubungi via WA
              </button>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
