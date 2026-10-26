/**
 * Contact Matcher Utility for UKS PLUS SCB
 * Normalizes phone numbers to Indonesian format (628xxxxxxxxxx) and performs
 * accurate grade/gender-based matching for Wali Kelas and Pembina Asrama contacts.
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

  return digits.length >= 9 ? digits : '';
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
  if (!studentGrade || !masterTeachers || masterTeachers.length === 0) {
    return {
      teacherName: 'Belum diatur',
      teacherWhatsApp: 'Belum diatur',
      supervisorName: 'Belum diatur',
      supervisorWhatsApp: 'Belum diatur',
      notFoundReason: !studentGrade ? 'Kelas siswa belum diisi/ditentukan' : 'Data kontak master belum dimuat'
    };
  }

  const { normalized: sNormGrade, rawNumber: sGradeNum } = normalizeGrade(studentGrade);
  const sGender = (studentGender || 'Laki-laki').toLowerCase();
  const isPutri = sGender === 'perempuan' || sGender.includes('putri') || sGender.includes('p');
  const targetGenderCategory = isPutri ? 'putri' : 'putra';

  // Helper to score a teacher candidate for a role ('wali_kelas' vs 'pembina')
  const scoreCandidate = (t: any, targetRole: 'wali_kelas' | 'pembina') => {
    let score = 0;

    const roleStr = (t.role || '').toString().toLowerCase();
    const nameStr = (t.name || '').toString().toLowerCase();
    const kategoriStr = (t.gender || t.kategori || t.jabatan || t.peran || '').toString().toLowerCase();
    const tGradeRaw = (t.grade || t.kelas || '').toString();

    const isWaliRole = roleStr === 'wali_kelas' || roleStr.includes('wali') || nameStr.includes('wali') || kategoriStr.includes('wali');
    const isPembinaRole = roleStr === 'pembina' || roleStr.includes('pembina') || nameStr.includes('pembina') || kategoriStr.includes('pembina');

    if (targetRole === 'wali_kelas') {
      if (isWaliRole) score += 10;
      else if (isPembinaRole) return -100; // Penalize if explicitly pembina
      else score += 2; // Neutral candidate
    } else { // pembina
      if (isPembinaRole) score += 10;
      else if (isWaliRole) return -100; // Penalize if explicitly wali
      else score += 2; // Neutral candidate
    }

    // Grade matching
    const { normalized: tNormGrade, rawNumber: tGradeNum } = normalizeGrade(tGradeRaw);

    if (tNormGrade && sNormGrade) {
      if (tNormGrade === sNormGrade) {
        score += 25; // Exact grade match e.g. "7a" === "7a"
      } else if (tNormGrade.includes(sNormGrade) || sNormGrade.includes(tNormGrade)) {
        score += 18;
      } else if (tGradeNum && sGradeNum && tGradeNum === sGradeNum) {
        score += 12; // Raw grade number match e.g. 7 === 7
      } else {
        score -= 10; // Different grade
      }
    } else if (tGradeNum && sGradeNum && tGradeNum === sGradeNum) {
      score += 10;
    }

    // Gender / Kategori match
    const genderTag = (t.gender || t.kategori || t.asrama || '').toString().toLowerCase();
    if (genderTag) {
      if (isPutri && (genderTag.includes('putri') || genderTag.includes('perempuan') || genderTag === 'p')) {
        score += 8;
      } else if (!isPutri && (genderTag.includes('putra') || genderTag.includes('laki') || genderTag === 'l')) {
        score += 8;
      } else if ((isPutri && (genderTag.includes('putra') || genderTag.includes('laki'))) || (!isPutri && (genderTag.includes('putri') || genderTag.includes('perempuan')))) {
        score -= 20; // Opposite gender mismatch
      }
    }

    return score;
  };

  let bestTeacher: any = null;
  let bestTeacherScore = 0;

  let bestSupervisor: any = null;
  let bestSupervisorScore = 0;

  for (const t of masterTeachers) {
    if (!t || !t.name || t.name === 'Tanpa Nama') continue;

    const teacherScore = scoreCandidate(t, 'wali_kelas');
    if (teacherScore > bestTeacherScore) {
      bestTeacherScore = teacherScore;
      bestTeacher = t;
    }

    const supervisorScore = scoreCandidate(t, 'pembina');
    if (supervisorScore > bestSupervisorScore) {
      bestSupervisorScore = supervisorScore;
      bestSupervisor = t;
    }
  }

  const teacherName = bestTeacher ? bestTeacher.name : 'Belum diatur';
  const teacherWaRaw = bestTeacher ? (bestTeacher.whatsapp || '') : '';
  const teacherWaClean = cleanWaNumber(teacherWaRaw);
  const teacherWhatsApp = teacherWaClean || 'Belum diatur';

  const supervisorName = bestSupervisor ? bestSupervisor.name : 'Belum diatur';
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

  return {
    teacherName,
    teacherWhatsApp,
    supervisorName,
    supervisorWhatsApp,
    notFoundReason: notFoundReason || undefined
  };
}
