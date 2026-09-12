import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * `legacy_export/patients.csv`, landed as it arrived.
 *
 * Every export column is `text` and nullable. The export has no types — a `dob`
 * is US-style in one row and ISO in the next, a `weight` may carry a unit in the
 * value — and coercing any of that at the schema level would reject or silently
 * rewrite the very rows the rules exist to find. The schema stores; rules
 * interpret.
 */
@Entity('legacy_patient')
export class LegacyPatient {
  /** Ours, not theirs. The export's id is `legacyPatientId` below. */
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * Theirs. Indexed because the import resolves existence with one `IN` query
   * over this column (1.0.1), and deliberately NOT unique: one file may carry
   * the same legacy id twice and both rows are inserted (1.0.3).
   */
  @Index()
  @Column({ name: 'legacy_id', type: 'text' })
  legacyPatientId!: string;

  @Column({ name: 'full_name', type: 'text', nullable: true })
  fullName!: string | null;

  @Column({ name: 'email', type: 'text', nullable: true })
  email!: string | null;

  @Column({ name: 'dob', type: 'text', nullable: true })
  dob!: string | null;

  @Column({ name: 'sex', type: 'text', nullable: true })
  sex!: string | null;

  @Column({ name: 'bsn', type: 'text', nullable: true })
  bsn!: string | null;

  @Column({ name: 'phone', type: 'text', nullable: true })
  phone!: string | null;

  @Column({ name: 'city', type: 'text', nullable: true })
  city!: string | null;

  @Column({ name: 'weight', type: 'text', nullable: true })
  weight!: string | null;

  @Column({ name: 'weight_unit', type: 'text', nullable: true })
  weightUnit!: string | null;

  @Column({ name: 'height_cm', type: 'text', nullable: true })
  heightCm!: string | null;

  @Column({ name: 'status', type: 'text', nullable: true })
  status!: string | null;

  @Column({ name: 'signup_date', type: 'text', nullable: true })
  signupDate!: string | null;

  @Column({ name: 'source', type: 'text', nullable: true })
  source!: string | null;

  /** The source row exactly as it arrived. Never written after import. */
  @Column({ name: 'raw_data', type: 'text' })
  rawData!: string;
}
