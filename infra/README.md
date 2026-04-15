# RokuRemote Infrastructure

CDK stack that deploys a CloudFront distribution backed by an S3 bucket for hosting the Angular SPA.

## What It Creates

- S3 bucket (`{prefix}-pages-{environment}`) — static site content
- CloudFront distribution — CDN with SPA routing (404/403 → index.html)
- Optional custom domain with ACM certificate

## Prerequisites

- [.NET 10 SDK](https://dotnet.microsoft.com/download)
- [AWS CDK CLI](https://docs.aws.amazon.com/cdk/v2/guide/cli.html) (`npm install -g aws-cdk`)
- AWS credentials configured (via `aws configure`, environment variables, or SSO)

## Configuration

The stack reads from `config.json` in the repo root (see `config.example.json`). You can also pass values via CDK context:

```bash
cdk deploy --context prefix=rokuremote --context environment=production
```

Config file takes precedence over context parameters.

## Commands

All commands should be run from the `infra/` directory.

| Command | Description |
|---|---|
| `cdk synth` | Synthesize the CloudFormation template |
| `cdk diff --context configFile=../config.json` | Preview changes before deploying |
| `cdk deploy --context configFile=../config.json` | Deploy the stack to AWS |
| `cdk destroy` | Tear down the stack |

## First-time setup

If this is the first CDK deployment to the AWS account/region, bootstrap it first:

```bash
cdk bootstrap
```

## Custom Domain

To use a custom domain (e.g., `roku.yourdomain.com`):

1. Create an ACM certificate in **us-east-1** (required for CloudFront)
2. Add the domain and certificate ARN to `config.json`
3. After deploying, create a CNAME or alias record in Route53 pointing to the CloudFront distribution domain
