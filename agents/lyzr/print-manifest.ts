/** Print the secret-free agent manifest (role, version, Safe AI policy) as JSON. */
import { agentManifest } from './configuration';
console.log(JSON.stringify(agentManifest(), null, 2));
