import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * `legacy_export/consents.jsonl`, one row per line, landed as it arrived. Text
 * throughout, for the same reason as `LegacyPatient`.
 */
@Entity('legacy_consent')
export class LegacyConsent {
  /** Ours, not theirs. */
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * Theirs, and the only legacy identifier a consent line carries: the export
   * gives consent events no id of their own, so the patient's legacy id doubles
   * as this table's legacy identity — which is what the import keys existence on
   * (1.0.1). Non-unique like the others, and far more so here: consents are an
   * append-only event log, so one patient has many lines and two identical lines
   * are two rows (1.0.4).
   */
  @Index()
  @Column({ name: 'patient_legacy_id', type: 'text' })
  legacyPatientId!: string;

  @Column({ name: 'type', type: 'text', nullable: true })
  type!: string | null;

  @Column({ name: 'action', type: 'text', nullable: true })
  action!: string | null;

  @Column({ name: 'at', type: 'text', nullable: true })
  at!: string | null;

  @Column({ name: 'version', type: 'text', nullable: true })
  version!: string | null;

  /** The source row exactly as it arrived. Never written after import. */
  @Column({ name: 'raw_data', type: 'text' })
  rawData!: string;
}
