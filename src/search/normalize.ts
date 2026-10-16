/**
 * Text normalisation shared by indexing and querying so both sides always agree.
 * Folds case and diacritics ("Monégasque" == "monegasque") and expands the common
 * Indonesian abbreviations used in street and facility names ("Jl." == "Jalan").
 */

const ABBREVIATIONS: Record<string, string[]> = {
  jl: ['jalan'], jln: ['jalan'], gg: ['gang'], rs: ['rumah', 'sakit'], rsu: ['rumah', 'sakit', 'umum'],
  rsud: ['rumah', 'sakit', 'umum', 'daerah'], puskesmas: ['pusat', 'kesehatan', 'masyarakat'],
  spbu: ['spbu', 'pom', 'bensin'], apt: ['apotek'], hr: ['hotel'], kec: ['kecamatan'], kel: ['kelurahan'],
  kab: ['kabupaten'], prov: ['provinsi'], st: ['stasiun'], bandara: ['bandara', 'airport'],
};

export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of fold(text).split(/[^\p{L}\p{N}]+/u)) {
    if (!raw) continue;
    const expanded = ABBREVIATIONS[raw];
    if (expanded) out.push(...expanded);
    else out.push(raw);
  }
  return out;
}
