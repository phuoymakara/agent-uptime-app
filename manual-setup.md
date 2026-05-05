# Verify what you already have
  node --version   # need v22.x
  aws --version    # need v2.x
  sam --version    # need 1.x+

  If anything is missing, install from the links in section 2.2.

  ---
  2. Configure AWS CLI with your new keys (section 2.3)

  aws configure
  
  Enter the Access Key ID and Secret from the .csv you downloaded in Step 4. Set
   default region to ap-southeast-1.

  Verify it worked:

  aws sts get-caller-identity

  You should see your account ID and uptime-agent-deployer in the ARN.

  ---
  3. Set your tokens

  You have .env.example open — those tokens are for local dev only. For the
  deploy you pass them directly via CLI. Pick something strong:

  export AGENT_TOKENS="your-secret-token-1,your-secret-token-2"

  ---
  4. Build the Lambda bundle

  yarn install
  yarn build:lambda
  # → dist/lambda.js  ~26KB

  ---
  5. First-time deploy to Singapore (section 5)

  sam deploy --guided \
    --config-env singapore \
    --parameter-overrides "AgentRegion=singapore AgentTokens=$AGENT_TOKENS"

    winpty "/c/Program Files/Amazon/AWSSAMCLI/bin/sam.cmd" deploy --guided \
    --config-env singapore \
    --parameter-overrides "AgentRegion=singapore AgentTokens=$AGENT_TOKENS"

    /*

    =--Deleete
    winpty "/c/Program Files/Amazon/AWSSAMCLI/bin/sam.cmd" delete --stack-name uptime-agent-singapore --region ap-southeast-1
    */

  SAM will ask a few questions interactively — accept the defaults and answer Y
  to "Save to samconfig.toml". It takes 2–3 minutes. At the end it prints your
  live endpoint URL.

  Then repeat for Sydney:

  Then repeat for Sydney:

  sam deploy --guided \
    --config-env sydney \
    --parameter-overrides "AgentRegion=sydney AgentTokens=$AGENT_TOKENS"

  ---
  6. Smoke test

  curl https://<your-endpoint>.execute-api.ap-southeast-1.amazonaws.com/health
  # {"ok":true,"region":"singapore","version":"1.0.0"}

  Once both regions are live, come back and we can set up the GitHub Actions secrets for CI/CD so future deploys happen automatically
   on every push to main.

   /
   -----------DD
   winpty "/c/Program Files/Amazon/AWSSAMCLI/bin/sam.cmd" delete --stack-name uptime-agent-singapore --region ap-southeast-1