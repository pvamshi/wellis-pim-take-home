import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * `legacy_export/intakes.csv`, landed as it arrived. Text throughout, for the
 * same reason as `LegacyPatient`.
 */
@Entity('legacy_intake')
export class LegacyIntake {
  /** Ours, not theirs. */
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * Theirs: the form tool's submission id, and this table's legacy identity.
   * Indexed for the import's single existence query, not unique (1.0.3).
   */
  @Index()
  @Column({ name: 'intake_id', type: 'text' })
  legacyIntakeId!: string;

  /**
   * Points at `legacy_patient.legacy_id`, but deliberately as an ordinary text
   * column: no relation, no foreign key. EXPORT-NOTES says the automation
   * sometimes fired before the patient row existed, so a constraint would reject
   * exactly the rows worth importing. A broken reference is a field-shaped
   * finding for a rule later (1.1.7).
   */
  @Column({ name: 'legacy_patient_id', type: 'text', nullable: true })
  legacyPatientId!: string | null;

  @Column({ name: 'submitted_at', type: 'text', nullable: true })
  submittedAt!: string | null;

  @Column({ name: 'questionnaire_version', type: 'text', nullable: true })
  questionnaireVersion!: string | null;

  @Column({ name: 'weight', type: 'text', nullable: true })
  weight!: string | null;

  @Column({ name: 'height', type: 'text', nullable: true })
  height!: string | null;

  @Column({ name: 'meds_current', type: 'text', nullable: true })
  medsCurrent!: string | null;

  @Column({ name: 'conditions', type: 'text', nullable: true })
  conditions!: string | null;

  @Column({ name: 'alcohol_units_week', type: 'text', nullable: true })
  alcoholUnitsWeek!: string | null;

  @Column({ name: 'outcome', type: 'text', nullable: true })
  outcome!: string | null;

  @Column({ name: 'reviewer_note', type: 'text', nullable: true })
  reviewerNote!: string | null;

  /** The source row exactly as it arrived. Never written after import. */
  @Column({ name: 'raw_data', type: 'text' })
  rawData!: string;
}
