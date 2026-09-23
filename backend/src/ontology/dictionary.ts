/**
 * Local terminology dictionary for the synthetic CT-2026-001 dataset.
 *
 * Supports LOINC (labs/vitals), SNOMED CT + ICD-10-CM (conditions/procedures),
 * RxNorm (medications) and ATC (drug classes). This is a hackathon-scale,
 * hand-curated subset — production deployments should resolve against a
 * licensed terminology server (e.g. FHIR $lookup / $translate). Codes are
 * provided for demonstration and should be verified against official sources.
 *
 * Anything not in this dictionary resolves to UNMAPPED — never guessed.
 */
export const ONTOLOGY_VERSION = 'tg-local-2026.09';

export type EntryKind = 'lab' | 'vital' | 'condition' | 'medication' | 'drug-class' | 'procedure' | 'procedure-class' | 'admin' | 'demographic';

export interface OntologyEntry {
  key: string;
  system: 'LOINC' | 'SNOMED' | 'ICD-10' | 'RXNORM' | 'ATC' | 'LOCAL';
  code: string;
  display: string;
  kind: EntryKind;
  synonyms: string[];
  /** Alternative codes (crosswalk). `prefix: true` matches ICD-10 descendants (E11 → E11.9). */
  altCodes?: Array<{ system: string; code: string; prefix?: boolean }>;
  /** Class memberships, by entry key. */
  classes?: string[];
  canonicalUnit?: string;
}

export const DICTIONARY: OntologyEntry[] = [
  // ---- Laboratory (LOINC) -------------------------------------------------
  { key: 'LOINC:4548-4', system: 'LOINC', code: '4548-4', display: 'Hemoglobin A1c/Hemoglobin.total in Blood', kind: 'lab', canonicalUnit: '%',
    synonyms: ['hba1c', 'hemoglobin a1c', 'haemoglobin a1c', 'glycated hemoglobin', 'glycated haemoglobin', 'a1c'] },
  { key: 'LOINC:62238-1', system: 'LOINC', code: '62238-1', display: 'Glomerular filtration rate/1.73 sq M.predicted [CKD-EPI]', kind: 'lab', canonicalUnit: 'mL/min/1.73m2',
    synonyms: ['egfr', 'egfr (ckd-epi)', 'estimated glomerular filtration rate', 'estimated gfr', 'gfr'], altCodes: [{ system: 'LOINC', code: '33914-3' }] },
  { key: 'LOINC:1742-6', system: 'LOINC', code: '1742-6', display: 'Alanine aminotransferase [Enzymatic activity/volume] in Serum or Plasma', kind: 'lab', canonicalUnit: 'U/L',
    synonyms: ['alt', 'alanine aminotransferase', 'alt (alanine aminotransferase)', 'sgpt'] },
  { key: 'LOINC:1920-8', system: 'LOINC', code: '1920-8', display: 'Aspartate aminotransferase [Enzymatic activity/volume] in Serum or Plasma', kind: 'lab', canonicalUnit: 'U/L',
    synonyms: ['ast', 'aspartate aminotransferase', 'ast (aspartate aminotransferase)', 'sgot'] },
  { key: 'LOINC:1975-2', system: 'LOINC', code: '1975-2', display: 'Bilirubin.total [Mass/volume] in Serum or Plasma', kind: 'lab', canonicalUnit: 'mg/dL',
    synonyms: ['total bilirubin', 'bilirubin total', 'bilirubin, total', 'tbili'] },
  { key: 'LOINC:2106-3', system: 'LOINC', code: '2106-3', display: 'Choriogonadotropin (pregnancy test) [Presence] in Urine', kind: 'lab',
    synonyms: ['pregnancy test', 'urine hcg pregnancy test', 'urine hcg', 'urine pregnancy test', 'hcg pregnancy test'] },
  // ---- Vitals -------------------------------------------------------------
  { key: 'LOINC:39156-5', system: 'LOINC', code: '39156-5', display: 'Body mass index (BMI) [Ratio]', kind: 'vital', canonicalUnit: 'kg/m2',
    synonyms: ['bmi', 'body mass index'] },

  // ---- Conditions (SNOMED CT with ICD-10-CM crosswalk) ----------------------
  { key: 'SNOMED:44054006', system: 'SNOMED', code: '44054006', display: 'Diabetes mellitus type 2', kind: 'condition',
    synonyms: ['type 2 diabetes mellitus', 'type 2 diabetes', 't2dm', 'diabetes mellitus type 2'], altCodes: [{ system: 'ICD-10', code: 'E11', prefix: true }] },
  { key: 'SNOMED:46635009', system: 'SNOMED', code: '46635009', display: 'Diabetes mellitus type 1', kind: 'condition',
    synonyms: ['type 1 diabetes mellitus', 'type 1 diabetes', 't1dm'], altCodes: [{ system: 'ICD-10', code: 'E10', prefix: true }] },
  { key: 'SNOMED:420422005', system: 'SNOMED', code: '420422005', display: 'Ketoacidosis due to diabetes mellitus', kind: 'condition',
    synonyms: ['diabetic ketoacidosis', 'dka'], altCodes: [{ system: 'ICD-10', code: 'E10.1', prefix: true }, { system: 'ICD-10', code: 'E11.1', prefix: true }] },
  { key: 'SNOMED:22298006', system: 'SNOMED', code: '22298006', display: 'Myocardial infarction', kind: 'condition',
    synonyms: ['myocardial infarction', 'heart attack', 'mi'], altCodes: [{ system: 'ICD-10', code: 'I21', prefix: true }] },
  { key: 'SNOMED:230690007', system: 'SNOMED', code: '230690007', display: 'Cerebrovascular accident', kind: 'condition',
    synonyms: ['stroke', 'cerebrovascular accident', 'cva'], altCodes: [{ system: 'ICD-10', code: 'I63', prefix: true }] },
  { key: 'SNOMED:84114007', system: 'SNOMED', code: '84114007', display: 'Heart failure', kind: 'condition',
    synonyms: ['heart failure', 'heart failure hospitalization', 'hospitalization for heart failure', 'congestive heart failure'], altCodes: [{ system: 'ICD-10', code: 'I50', prefix: true }] },
  { key: 'SNOMED:75694006', system: 'SNOMED', code: '75694006', display: 'Pancreatitis', kind: 'condition',
    synonyms: ['pancreatitis', 'acute pancreatitis', 'chronic pancreatitis'], altCodes: [{ system: 'ICD-10', code: 'K85', prefix: true }, { system: 'ICD-10', code: 'K86.1' }] },
  { key: 'SNOMED:363346000', system: 'SNOMED', code: '363346000', display: 'Malignant neoplastic disease', kind: 'condition',
    synonyms: ['malignancy', 'cancer', 'malignant neoplasm'], altCodes: [{ system: 'ICD-10', code: 'C', prefix: true }] },
  { key: 'SNOMED:38341003', system: 'SNOMED', code: '38341003', display: 'Hypertensive disorder', kind: 'condition',
    synonyms: ['essential hypertension', 'hypertension'], altCodes: [{ system: 'ICD-10', code: 'I10' }] },
  { key: 'SNOMED:55822004', system: 'SNOMED', code: '55822004', display: 'Hyperlipidemia', kind: 'condition',
    synonyms: ['hyperlipidemia', 'hyperlipidaemia'], altCodes: [{ system: 'ICD-10', code: 'E78', prefix: true }] },
  { key: 'SNOMED:13645005', system: 'SNOMED', code: '13645005', display: 'Chronic obstructive lung disease', kind: 'condition',
    synonyms: ['chronic obstructive pulmonary disease', 'copd'], altCodes: [{ system: 'ICD-10', code: 'J44', prefix: true }] },

  // ---- Drug classes (ATC) ---------------------------------------------------
  { key: 'ATC:H02AB', system: 'ATC', code: 'H02AB', display: 'Glucocorticoids (systemic)', kind: 'drug-class',
    synonyms: ['systemic corticosteroid', 'systemic corticosteroids', 'corticosteroid', 'glucocorticoid'] },
  { key: 'ATC:A10BJ', system: 'ATC', code: 'A10BJ', display: 'Glucagon-like peptide-1 (GLP-1) analogues', kind: 'drug-class',
    synonyms: ['glp-1 receptor agonist', 'glp-1 receptor agonists', 'glp-1 ra', 'glp-1 analogue'] },
  { key: 'ATC:A10A', system: 'ATC', code: 'A10A', display: 'Insulins and analogues', kind: 'drug-class', synonyms: ['insulin', 'insulins'] },

  // ---- Medications (RxNorm ingredients) ------------------------------------
  { key: 'RXNORM:6809', system: 'RXNORM', code: '6809', display: 'metformin', kind: 'medication', synonyms: ['metformin', 'metformin hydrochloride'] },
  { key: 'RXNORM:8640', system: 'RXNORM', code: '8640', display: 'prednisone', kind: 'medication', synonyms: ['prednisone'], classes: ['ATC:H02AB'] },
  { key: 'RXNORM:8638', system: 'RXNORM', code: '8638', display: 'prednisolone', kind: 'medication', synonyms: ['prednisolone'], classes: ['ATC:H02AB'] },
  { key: 'RXNORM:6902', system: 'RXNORM', code: '6902', display: 'methylprednisolone', kind: 'medication', synonyms: ['methylprednisolone'], classes: ['ATC:H02AB'] },
  { key: 'RXNORM:3264', system: 'RXNORM', code: '3264', display: 'dexamethasone', kind: 'medication', synonyms: ['dexamethasone'], classes: ['ATC:H02AB'] },
  { key: 'RXNORM:1991302', system: 'RXNORM', code: '1991302', display: 'semaglutide', kind: 'medication', synonyms: ['semaglutide'], classes: ['ATC:A10BJ'] },
  { key: 'RXNORM:475968', system: 'RXNORM', code: '475968', display: 'liraglutide', kind: 'medication', synonyms: ['liraglutide'], classes: ['ATC:A10BJ'] },
  { key: 'RXNORM:274783', system: 'RXNORM', code: '274783', display: 'insulin glargine', kind: 'medication', synonyms: ['insulin glargine'], classes: ['ATC:A10A'] },
  { key: 'RXNORM:29046', system: 'RXNORM', code: '29046', display: 'lisinopril', kind: 'medication', synonyms: ['lisinopril'] },
  { key: 'RXNORM:83367', system: 'RXNORM', code: '83367', display: 'atorvastatin', kind: 'medication', synonyms: ['atorvastatin'] },
  { key: 'RXNORM:17767', system: 'RXNORM', code: '17767', display: 'amlodipine', kind: 'medication', synonyms: ['amlodipine'] },
  { key: 'RXNORM:69120', system: 'RXNORM', code: '69120', display: 'tiotropium', kind: 'medication', synonyms: ['tiotropium'] },

  // ---- Procedures (SNOMED CT) ------------------------------------------------
  { key: 'LOCAL:major-surgery', system: 'LOCAL', code: 'major-surgery', display: 'Major surgery (protocol-defined class)', kind: 'procedure-class', synonyms: ['major surgery'] },
  { key: 'SNOMED:415070008', system: 'SNOMED', code: '415070008', display: 'Percutaneous coronary intervention', kind: 'procedure', synonyms: ['percutaneous coronary intervention', 'pci'] },
  { key: 'SNOMED:232717009', system: 'SNOMED', code: '232717009', display: 'Coronary artery bypass grafting', kind: 'procedure', synonyms: ['coronary artery bypass graft', 'cabg'], classes: ['LOCAL:major-surgery'] },
  { key: 'SNOMED:52734007', system: 'SNOMED', code: '52734007', display: 'Total replacement of hip', kind: 'procedure', synonyms: ['hip replacement', 'total hip replacement'], classes: ['LOCAL:major-surgery'] },
  { key: 'SNOMED:38102005', system: 'SNOMED', code: '38102005', display: 'Cholecystectomy', kind: 'procedure', synonyms: ['cholecystectomy'], classes: ['LOCAL:major-surgery'] },
  { key: 'SNOMED:73761001', system: 'SNOMED', code: '73761001', display: 'Colonoscopy', kind: 'procedure', synonyms: ['colonoscopy', 'screening colonoscopy'] },
  { key: 'SNOMED:110473004', system: 'SNOMED', code: '110473004', display: 'Cataract surgery', kind: 'procedure', synonyms: ['cataract surgery', 'cataract surgery (left eye)', 'cataract surgery (right eye)'] },

  // ---- Administrative / demographic ----------------------------------------
  { key: 'LOCAL:informed-consent', system: 'LOCAL', code: 'informed-consent', display: 'Written informed consent obtained', kind: 'admin',
    synonyms: ['informed consent', 'informed consent signed', 'written informed consent'] },
  { key: 'LOCAL:sex', system: 'LOCAL', code: 'sex', display: 'Administrative sex', kind: 'demographic', synonyms: ['administrative sex', 'sex'] },
  { key: 'LOCAL:age', system: 'LOCAL', code: 'age', display: 'Age at screening (derived)', kind: 'demographic', synonyms: ['age'] },
];
