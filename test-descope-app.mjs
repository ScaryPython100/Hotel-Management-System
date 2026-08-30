import descopeSdk from '@descope/node-sdk';
const descope = descopeSdk({ projectId: "dummy" });
console.log(Object.keys(descope.management.inboundApplication));
