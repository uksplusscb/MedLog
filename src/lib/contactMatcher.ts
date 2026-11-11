/**
 * Contact Matcher Utility for UKS PLUS SCB
 * Normalizes phone numbers to Indonesian format (628xxxxxxxxxx) and performs
 * accurate grade/gender-based matching for Wali Kelas and Pembina Asrama contacts
 * strictly for students in Grades 7, 8, 9, 10, 11, and 12.
 */

export function cleanWaNumber(phone: string | number | null | undefined): string {
  if (!phone) return '';
  let str = String(phone).trim();
  
  // Remove all non-digit characters
  let digits = str.replace(/\D/g, '');
  if (!digits) return '';

  // Prevent duplicated 62 prefixes (e.g. 62628...)
  while (digits.startsWith('6262')) {
    digits = digits.slice(2);
  }

  // Convert Indonesian domestic prefixes
  if (digits.startsWith('08')) {
    digits = '628' + digits.slice(2);
  } else if (digits.startsWith('8')) {
    digits = '62' + digits;
  } else if (digits.startsWith('62')) {
    // Already correct
  } else if (digits.length >= 8) {
    digits = '62' + digits;
  }

  // Final check for duplicated 62
  while (digits.startsWith('6262')) {
    digits = digits.slice(2);
  }

  return digits.length >= 10 ? digits : '';
}

export function normalizeGrade(gradeStr: string | number | null | undefined): { normalized: string; rawNumber: string } {
  if (!gradeStr) return { normalized: '', rawNumber: '' };
  let s = String(gradeStr).trim().toLowerCase();

  // Remove common prefixes
  s = s.replace(/^(kelas|rombel|thn|tahun)\s+/i, '');

  // Convert Roman numerals at word boundaries
  s = s.replace(/\bxii\b/g, '12')
       .replace(/\bxi\b/g, '11')
       .replace(/\bx\b/g, '10')
       .replace(/\bix\b/g, '9')
       .replace(/\bviii\b/g, '8')
       .replace(/\bvii\b/g, '7')
       .replace(/\bvi\b/g, '6');

  // Extract raw number (e.g. '7' from '7 A')
  const numMatch = s.match(/\d+/);
  const rawNumber = numMatch ? numMatch[0] : '';

  // Clean non-alphanumeric chars for exact compact matching e.g. "7a"
  const normalized = s.replace(/[^a-z0-9]/g, '');

  return { normalized, rawNumber };
}

/**
 * Checks if a given grade string corresponds to a valid Student in Grades 7, 8, 9, 10, 11, or 12.
 * Returns FALSE for staff/karyawan roles (Guru, Kepala Sekolah, Operasional, Pembina, Dapur, Umum, etc.).
 */
export function isStudentGrade7To12(gradeStr: string | number | null | undefined): boolean {
  if (!gradeStr) return false;
  const s = String(gradeStr).trim().toLowerCase();
  if (!s) return false;

  // Keyword check for staff / employee (karyawan) positions
  const staffKeywords = [
    'guru', 
    'kepala sekolah', 
    'kepsek', 
    'wakil kepala', 
    'wakepsek', 
    'operasional', 
    'pembina', 
    'dapur', 
    'umum', 
    'karyawan', 
    'staf', 
    'staff', 
    'pegawai', 
    'petugas', 
    'driver', 
    'satpam', 
    'security', 
    'kebersihan', 
    'admin', 
    'yayasan', 
    'manajemen'
  ];

  for (const kw of staffKeywords) {
    if (s.includes(kw)) {
      return false; // Explicit staff/employee patient
    }
  }

  // Check if grade contains a number between 7 and 12
  const { rawNumber } = normalizeGrade(s);
  if (!rawNumber) return false;

  const num = parseInt(rawNumber, 10);
  return !isNaN(num) && num >= 7 && num <= 12;
}

export interface MatchedContacts {
  teacherName: string;
  teacherWhatsApp: string; // clean format 628... or 'Belum diatur'
  supervisorName: string;
  supervisorWhatsApp: string; // clean format 628... or 'Belum diatur'
  notFoundReason?: string;
}

export function findMatchingContacts(
  studentGrade: string | undefined,
  studentGender: string | undefined,
  masterTeachers: any[]
): MatchedContacts {
  // Rule 1, 3, 4: Validate that patient is a student in Grades 7–12.
  // Staff/employees (Guru, Kepsek, Operasional, Dapur, Pembina Asrama, Umum, etc.) MUST NOT have Wali/Pembina auto-populated.
  if (!studentGrade || !isStudentGrade7To12(studentGrade)) {
    return {
      teacherName: 'Belum diatur',
      teacherWhatsApp: 'Belum diatur',
      supervisorName: 'Belum diatur',
      supervisorWhatsApp: 'Belum diatur',
      notFoundReason: !studentGrade 
        ? 'Kelas siswa belum diisi' 
        : 'Kontak Wali Kelas & Pembina Asrama hanya berlaku untuk siswa kelas 7-12 (Karyawan/staf tidak menggunakan kontak Wali/Pembina).'
    };
  }

  if (!masterTeachers || masterTeachers.length === 0) {
    return {
      teacherName: 'Belum diatur',
      teacherWhatsApp: 'Belum diatur',
      supervisorName: 'Belum diatur',
      supervisorWhatsApp: 'Belum diatur',
      notFoundReason: 'Data kontak master belum dimuat dari Google Spreadsheet'
    };
  }

  const { rawNumber: targetGradeNum } = normalizeGrade(studentGrade);
  const sGender = (studentGender || 'Laki-laki').toLowerCase();
  const isPutri = sGender === 'perempuan' || sGender.includes('putri') || sGender.includes('p');
  const targetCategory = isPutri ? 'putri' : 'putra';

  let bestTeacher: any = null;
  let bestSupervisor: any = null;

  for (const t of masterTeachers) {
    if (!t || !t.name || t.name === 'Tanpa Nama') continue;

    const roleStr = (t.role || '').toString().toLowerCase();
    const isWaliRole = roleStr === 'wali_kelas' || roleStr.includes('wali');
    const isPembinaRole = roleStr === 'pembina' || roleStr.includes('pembina');

    const tGradeRaw = (t.grade || t.kelas || '').toString();
    const { rawNumber: tGradeNum } = normalizeGrade(tGradeRaw);

    const genderTag = (t.gender || t.kategori || t.asrama || '').toString().toLowerCase();
    const candidateIsPutri = genderTag.includes('putri') || genderTag.includes('perempuan') || genderTag === 'p';
    const candidateIsPutra = genderTag.includes('putra') || genderTag.includes('laki') || genderTag === 'l';

    // Verify Category match
    const categoryMatches = (isPutri && candidateIsPutri) || (!isPutri && candidateIsPutra);

    // 1. Wali Kelas Matching (Strict Grade Number & Category)
    if (isWaliRole && categoryMatches && tGradeNum === targetGradeNum) {
      bestTeacher = t;
    }

    // 2. Pembina Asrama Matching (Strict Grade Number & Category, or Level Match)
    if (isPembinaRole && categoryMatches) {
      if (tGradeNum === targetGradeNum) {
        bestSupervisor = t;
      } else if (!bestSupervisor) {
        // Fallback for Pembina Asrama level match (e.g. SMP vs SMA)
        const isSMP = parseInt(targetGradeNum, 10) <= 9;
        const candidateIsSMP = genderTag.includes('smp') || tGradeRaw.toLowerCase().includes('smp');
        const candidateIsSMA = genderTag.includes('sma') || tGradeRaw.toLowerCase().includes('sma');

        if ((isSMP && candidateIsSMP) || (!isSMP && candidateIsSMA)) {
          bestSupervisor = t;
        }
      }
    }
  }

  const teacherName = bestTeacher ? bestTeacher.name.trim() : 'Belum diatur';
  const teacherWaRaw = bestTeacher ? (bestTeacher.whatsapp || '') : '';
  const teacherWaClean = cleanWaNumber(teacherWaRaw);
  const teacherWhatsApp = teacherWaClean || 'Belum diatur';

  const supervisorName = bestSupervisor ? bestSupervisor.name.trim() : 'Belum diatur';
  const supervisorWaRaw = bestSupervisor ? (bestSupervisor.whatsapp || '') : '';
  const supervisorWaClean = cleanWaNumber(supervisorWaRaw);
  const supervisorWhatsApp = supervisorWaClean || 'Belum diatur';

  let notFoundReason = '';
  if (!bestTeacher && !bestSupervisor) {
    notFoundReason = `Kontak Wali Kelas & Pembina belum diatur di Google Spreadsheet Data Master untuk kelas ${studentGrade} (${studentGender})`;
  } else if (!bestTeacher) {
    notFoundReason = `Kontak Wali Kelas tidak ditemukan di Google Spreadsheet Data Master untuk kelas ${studentGrade}`;
  } else if (!bestSupervisor) {
    notFoundReason = `Kontak Pembina tidak ditemukan di Google Spreadsheet Data Master untuk kelas ${studentGrade}`;
  }

  console.log(`[UKS CONTACT MATCHER] Match Result for Grade ${studentGrade} (${studentGender}):`);
  console.log(` -> Wali Kelas: '${teacherName}' (${teacherWhatsApp})`);
  console.log(` -> Pembina: '${supervisorName}' (${supervisorWhatsApp})`);

  return {
    teacherName,
    teacherWhatsApp,
    supervisorName,
    supervisorWhatsApp,
    notFoundReason: notFoundReason || undefined
  };
}
