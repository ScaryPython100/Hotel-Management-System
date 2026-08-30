import descopeSdk from '@descope/node-sdk';
const descope = descopeSdk({ projectId: "dummy" });
console.log(descope.flow.start.toString());
