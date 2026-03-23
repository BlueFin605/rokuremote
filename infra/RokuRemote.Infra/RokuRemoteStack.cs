using Amazon.CDK;
using Amazon.CDK.AWS.CloudFront;
using Amazon.CDK.AWS.CloudFront.Origins;
using Amazon.CDK.AWS.IAM;
using Amazon.CDK.AWS.S3;
using Constructs;

public class RokuRemoteStack : Stack
{
    public RokuRemoteStack(Construct scope, string id, IStackProps? props = null)
        : base(scope, id, props)
    {
        var bucket = new Bucket(this, "SiteBucket", new BucketProps
        {
            BucketName = "rokuremote-pages-production",
            RemovalPolicy = RemovalPolicy.DESTROY,
            AutoDeleteObjects = true,
            BlockPublicAccess = BlockPublicAccess.BLOCK_ALL
        });

        var distribution = new Distribution(this, "SiteDistribution", new DistributionProps
        {
            DefaultBehavior = new BehaviorOptions
            {
                Origin = S3BucketOrigin.WithOriginAccessControl(bucket),
                ViewerProtocolPolicy = ViewerProtocolPolicy.ALLOW_ALL,
                CachePolicy = CachePolicy.CACHING_OPTIMIZED
            },
            DefaultRootObject = "index.html",
            ErrorResponses = new[]
            {
                // Angular SPA: route 404s back to index.html
                new ErrorResponse
                {
                    HttpStatus = 404,
                    ResponseHttpStatus = 200,
                    ResponsePagePath = "/index.html",
                    Ttl = Duration.Seconds(0)
                },
                new ErrorResponse
                {
                    HttpStatus = 403,
                    ResponseHttpStatus = 200,
                    ResponsePagePath = "/index.html",
                    Ttl = Duration.Seconds(0)
                }
            }
        });

        // Output the CloudFront URL and S3 bucket name for the deploy workflow
        _ = new CfnOutput(this, "DistributionDomainName", new CfnOutputProps
        {
            Value = distribution.DistributionDomainName,
            Description = "CloudFront distribution domain name"
        });

        _ = new CfnOutput(this, "DistributionId", new CfnOutputProps
        {
            Value = distribution.DistributionId,
            Description = "CloudFront distribution ID"
        });

        _ = new CfnOutput(this, "BucketName", new CfnOutputProps
        {
            Value = bucket.BucketName,
            Description = "S3 bucket name for site content"
        });
    }
}
