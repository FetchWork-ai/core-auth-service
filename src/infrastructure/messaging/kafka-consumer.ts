import { Kafka, Consumer } from 'kafkajs';
import { config } from '../../config/index.js';
import { logger } from '../../shared/logger.js';
import { KnowledgeBaseService } from '../../modules/knowledge-base/kb.service.js';

export class KafkaConsumer {
  private consumer: Consumer | null = null;
  private isConnected = false;

  constructor(private readonly kbService: KnowledgeBaseService) {}

  async start(): Promise<void> {
    if (this.isConnected) return;

    const kafka = new Kafka({
      clientId: 'user-kb-service-consumer',
      brokers: config.KAFKA_BROKERS,
      retry: { retries: 3 },
    });

    // 1. Programmatically ensure the topic exists before subscribing
    const admin = kafka.admin();
    try {
      await admin.connect();
      const topics = await admin.listTopics();
      const targetTopic = 'user-kb.ProfileEnriched';

      if (!topics.includes(targetTopic)) {
        logger.info({ topic: targetTopic }, 'Topic does not exist, creating it programmatically...');
        await admin.createTopics({
          topics: [{
            topic: targetTopic,
            numPartitions: 1,
            replicationFactor: 1,
          }],
        });
        logger.info({ topic: targetTopic }, 'Topic created successfully');
      }
    } catch (adminError) {
      logger.warn({ err: adminError }, 'Failed to check/create topic via Kafka Admin client, continuing...');
    } finally {
      await admin.disconnect();
    }

    // 2. Connect the consumer
    this.consumer = kafka.consumer({
      groupId: 'user-kb-service-group',
    });

    try {
      await this.consumer.connect();
      this.isConnected = true;
      logger.info('Kafka consumer connected');

      await this.consumer.subscribe({
        topic: 'user-kb.ProfileEnriched',
        fromBeginning: false,
      });
      logger.info('Kafka consumer subscribed to user-kb.ProfileEnriched');

      await this.consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
          try {
            if (!message.value) {
              logger.warn({ topic, partition }, 'Received empty message');
              return;
            }

            const rawContent = message.value.toString();
            const envelope = JSON.parse(rawContent);
            logger.info({ eventType: envelope.eventType, eventId: envelope.eventId }, 'Received event');

            if (envelope.eventType === 'ProfileEnriched') {
              const { userId, profileGraph } = envelope.payload;

              if (!userId || !profileGraph) {
                logger.warn('ProfileEnriched payload is missing userId or profileGraph');
                return;
              }

              // Fetch existing KB version first (to satisfy optimistic concurrency check)
              const existingResult = await this.kbService.getKnowledgeBase(userId);
              let expectedVersion = 0;
              if (existingResult.isOk() && existingResult.value) {
                expectedVersion = existingResult.value.version;
              }

              logger.info({ userId }, 'Processing ProfileEnriched event');
              const upsertResult = await this.kbService.upsertProfileGraph(userId, profileGraph, expectedVersion);

              if (upsertResult.isErr()) {
                logger.error({ err: upsertResult.error, userId }, 'Failed to save enriched profile graph');
              } else {
                logger.info({ userId }, 'Successfully saved enriched profile graph');
              }
            } else {
              logger.warn({ eventType: envelope.eventType }, 'Unrecognized event type');
            }
          } catch (err) {
            logger.error({ err }, 'Error processing message from Kafka');
          }
        },
      });

    } catch (error) {
      logger.error({ err: error }, 'Failed to start Kafka consumer');
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    if (this.consumer) {
      await this.consumer.disconnect();
      this.isConnected = false;
      logger.info('Kafka consumer disconnected');
    }
  }
}
