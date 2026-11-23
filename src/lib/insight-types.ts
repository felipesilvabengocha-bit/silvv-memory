export type InsightSourceType =
  | 'message'
  | 'knowledge_message'
  | 'agent_message'
  | 'agent_memory'
  | 'note'
  | 'memory'
  | 'memory_event'
  | 'person'
  | 'project'
  | 'task'
  | 'calendar_event'
  | 'file';

export type InsightConfidence = 'high' | 'medium' | 'low';
export type InsightProminence = 'high' | 'normal' | 'low';

export interface PersonalInsightEvidence {
  sourceKey: string;
  sourceType: InsightSourceType;
  sourceId: string;
  conversationId?: string | null;
  title: string;
  excerpt: string;
  sourceDate: string | null;
  revision: string;
}

export interface InsightChartPoint {
  period: string;
  count: number;
}

export interface PersonalInsight {
  id: string;
  title: string;
  narrative: string;
  rationale: string;
  confidence: InsightConfidence;
  prominence: InsightProminence;
  periodStart: string | null;
  periodEnd: string | null;
  evidence: PersonalInsightEvidence[];
  visualization: {
    kind: 'line' | 'bar' | 'none';
    label: string;
    points: InsightChartPoint[];
  } | null;
  isStarred: boolean;
  userCorrection?: string | null;
  dismissedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PersonalInsightsResponse {
  insights: PersonalInsight[];
  sourceCount: number;
  sourceCounts: Partial<Record<InsightSourceType, number>>;
  lastAnalyzedAt: string | null;
  needsUpdate: boolean;
  changedSourceTypes: string[];
}

export interface PersonalInsightRefreshResponse extends PersonalInsightsResponse {
  generatedCount: number;
  analyzed: boolean;
}

export interface PersonalInsightQuestionResponse {
  answer: string;
}
