import { SCurveRepository } from '../../domain/s_curve/repository.js';
import { SCurve } from '../../domain/s_curve/entity.js';

export class InMemorySCurveRepository implements SCurveRepository {
  private store: Map<string, SCurve> = new Map();

  async save(sCurve: SCurve): Promise<void> {
    this.store.set(sCurve.id, sCurve);
  }

  async findById(id: string): Promise<SCurve | null> {
    return this.store.get(id) || null;
  }

  async findAll(): Promise<SCurve[]> {
    return Array.from(this.store.values());
  }

  async findByTechnology(technologyName: string): Promise<SCurve[]> {
    return Array.from(this.store.values()).filter(
      s => s.technologyName === technologyName,
    );
  }

  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}
