import { registerAs } from '@nestjs/config';
import { readEnvVarPreferDotenvFile } from './read-env-var.util';

export const openfdaConfig = registerAs('openfda', () => ({
  apiKey: readEnvVarPreferDotenvFile('OPENDFDA_API_KEY'),
}));
