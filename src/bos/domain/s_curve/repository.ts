import { SCurve } from './entity.js';

export interface SCurveRepository {
  save(sCurve: SCurve): Promise<void>;
  findById(id: string): Promise<SCurve | null>;
  findAll(): Promise<SCurve[]>;
  findByTechnology(technologyName: string): Promise<SCurve[]>;
  delete(id: string): Promise<void>;
}
