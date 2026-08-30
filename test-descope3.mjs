import descopeSdk from '@descope/node-sdk';
const descope = descopeSdk({ projectId: "dummy" });
console.log(descope.management.flow.run.toString());
