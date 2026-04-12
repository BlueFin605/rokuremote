using Amazon.CDK;
using Amazon.CDK.AWS.CertificateManager;
using Amazon.CDK.AWS.CloudFront;
using Amazon.CDK.AWS.CloudFront.Origins;
using Amazon.CDK.AWS.S3;
using Constructs;

public class RokuRemoteStack : Stack
{
    public RokuRemoteStack(Construct scope, string id, IStackProps? props, RokuRemoteConfig config)
        : base(scope, id, props)
    {
        var bucketName = $"{config.Prefix}-pages-{config.Environment}";

        var bucket = new Bucket(this, "SiteBucket", new BucketProps
        {
            BucketName = bucketName,
            RemovalPolicy = config.IsProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
            AutoDeleteObjects = !config.IsProd,
            BlockPublicAccess = BlockPublicAccess.BLOCK_ALL
        });

        // Optional custom domain with certificate
        ICertificate? certificate = null;
        string[]? domainNames = null;

        if (!string.IsNullOrEmpty(config.DomainName) && !string.IsNullOrEmpty(config.CertificateArnUsEast1))
        {
            certificate = Certificate.FromCertificateArn(this, "Certificate", config.CertificateArnUsEast1);
            domainNames = new[] { config.DomainName };
        }

        var firmwareCorsPolicy = new ResponseHeadersPolicy(this, "FirmwareCorsPolicy", new ResponseHeadersPolicyProps
        {
            Comment = "Allow cross-origin firmware metadata fetches from ESP32-hosted web UI",
            CorsBehavior = new ResponseHeadersCorsBehavior
            {
                AccessControlAllowCredentials = false,
                AccessControlAllowHeaders = new[] { "*" },
                AccessControlAllowMethods = new[] { "GET", "HEAD", "OPTIONS" },
                AccessControlAllowOrigins = new[] { "*" },
                AccessControlExposeHeaders = new[] { "ETag", "Content-Length", "Content-Type" },
                AccessControlMaxAge = Duration.Seconds(86400),
                OriginOverride = true
            }
        });

        var distribution = new Distribution(this, "SiteDistribution", new DistributionProps
        {
            DefaultBehavior = new BehaviorOptions
            {
                Origin = S3BucketOrigin.WithOriginAccessControl(bucket),
                ViewerProtocolPolicy = ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                CachePolicy = CachePolicy.CACHING_OPTIMIZED
            },
            AdditionalBehaviors = new Dictionary<string, IBehaviorOptions>
            {
                ["/firmware/*"] = new BehaviorOptions
                {
                    Origin = S3BucketOrigin.WithOriginAccessControl(bucket),
                    ViewerProtocolPolicy = ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    CachePolicy = CachePolicy.CACHING_DISABLED,
                    AllowedMethods = AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
                    ResponseHeadersPolicy = firmwareCorsPolicy
                }
            },
            DefaultRootObject = "index.html",
            Certificate = certificate,
            DomainNames = domainNames,
            ErrorResponses = new[]
            {
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
