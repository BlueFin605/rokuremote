# RokuRemote Infrastructure

CDK stack that deploys a CloudFront distribution backed by an S3 bucket for hosting the site.

## Prerequisites

- [.NET 9 SDK](https://dotnet.microsoft.com/download)
- [AWS CDK CLI](https://docs.aws.amazon.com/cdk/v2/guide/cli.html) (`npm install -g aws-cdk`)
- AWS credentials configured (via `aws configure`, environment variables, or SSO)

## Commands

All commands should be run from the `infra/` directory.

| Command | Description |
|---|---|
| `cdk synth` | Synthesize the CloudFormation template |
| `cdk diff` | Preview changes before deploying |
| `cdk deploy` | Deploy the stack to AWS |
| `cdk destroy` | Tear down the stack |

## First-time setup

If this is the first CDK deployment to the AWS account/region, bootstrap it first:

```
cdk bootstrap
```

## Deploying

```
cdk diff      # review planned changes
cdk deploy    # deploy to AWS
```

The deploy output will print the CloudFront distribution domain name, distribution ID, and S3 bucket name.
