import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../../config/config.module.js';
import { PushProvider } from './push.provider.js';
import { MockPushProvider } from './mock-push.provider.js';
import { ExpoPushProvider } from './expo-push.provider.js';
import { FcmPushProvider, readServiceAccount } from './fcm-push.provider.js';

@Global()
@Module({
  providers: [
    {
      provide: PushProvider,
      useFactory: (config: AppConfig): PushProvider => {
        switch (config.get('PUSH_PROVIDER')) {
          case 'fcm':
            // Read at boot: a missing or wrong key file stops the API with the
            // path in the message, rather than every push failing quietly later.
            return new FcmPushProvider(readServiceAccount(config.get('FCM_SERVICE_ACCOUNT_FILE')!));
          case 'expo':
            return new ExpoPushProvider(config);
          default:
            return new MockPushProvider();
        }
      },
      inject: [AppConfig],
    },
  ],
  exports: [PushProvider],
})
export class PushModule {}
