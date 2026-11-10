export default () => ({
  port: parseInt(process.env.PORT ?? '3002', 10),

  grpc: {
    // address this service listens on for other services
    url: process.env.GRPC_URL ?? '0.0.0.0:50054',
    authUrl: process.env.AUTH_GRPC_URL ?? 'localhost:50051',
    userUrl: process.env.USER_GRPC_URL ?? 'localhost:50056',
    taskUrl: process.env.TASK_GRPC_URL ?? 'localhost:50058',
  },

  rabbitmq: {
    url: process.env.RABBITMQ_URL ?? 'amqp://localhost:5672',
  },

  mongo: {
    uri: process.env.MONGO_URI,
  },
});
