import { Result } from '../../shared/result.js';

export class KnowledgeBaseService {
  async getKnowledgeBase(_userId: string): Promise<Result<any, Error>> {
    return Result.err(new Error('Not implemented'));
  }

  async upsertProfileGraph(
    _userId: string,
    _incoming: any,
    _expectedVersion: number
  ): Promise<Result<any, Error>> {
    return Result.err(new Error('Not implemented'));
  }
}