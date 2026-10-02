/** Keep billing failures separate from authentication; never suggest CLI login for API credit errors. */
export function botErrorKind(error: string): 'coordination-credentials' | 'credential-read' | 'credential-unavailable' | 'credential-decrypt' | 'credential-missing' | 'retry-unavailable' | 'coordination-failed' | 'credits' | 'api-auth' | 'local-auth' | 'local-timeout' | 'local-failed' | 'local-exited' | 'local-incomplete' | 'local-empty' | 'local-output-limit' | null {
  if (/CONVERSATION_RETRY_UNAVAILABLE|This older response has no retry snapshot/.test(error)) return 'retry-unavailable';
  if (error.startsWith('BOT_CREDENTIAL_READ')) return 'credential-read';
  if (error.startsWith('BOT_CREDENTIAL_UNAVAILABLE')) return 'credential-unavailable';
  if (error.startsWith('BOT_CREDENTIAL_DECRYPT')) return 'credential-decrypt';
  if (error.startsWith('BOT_CREDENTIAL_MISSING')) return 'credential-missing';
  if (error.startsWith('COORDINATION_CREDENTIAL_FAILED')) return 'coordination-credentials';
  if (error.startsWith('COORDINATION_FAILED')) return 'coordination-failed';
  if (error.startsWith('LOCAL_AGENT_AUTH_REQUIRED')) return 'local-auth';
  if (error.startsWith('LOCAL_AGENT_TIMEOUT')) return 'local-timeout';
  if (error.startsWith('LOCAL_AGENT_TURN_FAILED')) return 'local-failed';
  if (error.startsWith('LOCAL_AGENT_EXITED')) return 'local-exited';
  if (error.startsWith('LOCAL_AGENT_EMPTY')) return 'local-empty';
  if (error.startsWith('LOCAL_AGENT_OUTPUT_LIMIT')) return 'local-output-limit';
  if (error.startsWith('LOCAL_AGENT_INCOMPLETE') || error.startsWith('Local agent did not complete.')) return 'local-incomplete';
  if (/requires more credits|insufficient[_ ](?:credits|quota)|can only afford|credit balance|余额不足/i.test(error)) return 'credits';
  if (/invalid[_ ]api[_ -]?key|incorrect api key|HTTP 401|invalid authentication/i.test(error)) return 'api-auth';
  return null;
}
