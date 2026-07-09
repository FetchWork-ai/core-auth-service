import { Kafka, Producer, Partitioners } from 'kafkajs';
import { randomUUID } from 'node:crypto';
import { config } from '../../config/index.js';
import { logger } from '../../shared/logger.js';

export const EventName = {
  ProfileEnrichmentTriggered: 'ProfileEnrichmentTriggered',
  UserDeleted: 'UserDeleted',
  PreferencesUpdated: 'PreferencesUpdated',
} as const;

interface EventPayloads {
  [EventName.ProfileEnrichmentTriggered]: {
    userId: string;
    provider: string;
    providerAccessToken: string;
    linkedinProfileUrl?: string;
    githubProfileUrl?: string;
  };
  [EventName.UserDeleted]: { userId: string };
  [EventName.PreferencesUpdated]: { userId: string };
}

export interface Envelope<E extends keyof EventPayloads> {
  eventId: string;
  eventType: E;
  version: string;
  timestamp: string;
  payload: EventPayloads[E];
}

export class KafkaProducer {
  private producer: Producer | null = null;
  private isConnected = false;

  async start(): Promise<void> {
    if (this.isConnected) return;

    const kafka = new Kafka({
      clientId: 'user-kb-service',
      brokers: config.KAFKA_BROKERS,
      retry: { retries: 3 },
    });

    this.producer = kafka.producer({
      createPartitioner: Partitioners.DefaultPartitioner,
      allowAutoTopicCreation: true,
    });

    try {
      await this.producer.connect();
      this.isConnected = true;
      logger.info('Kafka producer connected');
    } catch (error) {
      logger.error({ err: error }, 'Failed to connect Kafka producer');
      throw error;
    }
  }

  async publish<E extends keyof EventPayloads>(
    eventType: E,
    payload: EventPayloads[E]
  ): Promise<void> {
    if (!this.producer || !this.isConnected) {
      logger.warn('Kafka producer not connected, skipping publish');
      return;
    }

    const message: Envelope<E> = {
      eventId: randomUUID(),
      eventType,
      version: '1.0',
      timestamp: new Date().toISOString(),
      payload,
    };

    const topic = `user-kb.${eventType}`;

    try {
      await this.producer.send({
        topic,
        messages: [
          {
            key: (payload as any).userId,
            value: JSON.stringify(message),
          },
        ],
      });
      logger.debug({ eventType, topic }, 'Published event to Kafka');
    } catch (error) {
      logger.error({ err: error, eventType }, 'Failed to publish event to Kafka');
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    if (this.producer) {
      await this.producer.disconnect();
      this.isConnected = false;
      logger.info('Kafka producer disconnected');
    }
  }
}