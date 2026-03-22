using Amazon.CDK;

var app = new App();
new RokuRemoteStack(app, "RokuRemoteStack", new StackProps
{
    Env = new Amazon.CDK.Environment
    {
        Region = "ap-southeast-2"
    }
});
app.Synth();
