CloudFormation outputs from deployed stack
-------------------------------------------------------------------------------------------------------------------------------------------------------
Outputs                                                                                                                                               
-------------------------------------------------------------------------------------------------------------------------------------------------------
Key                 FunctionName                                                                                                                      
Description         Lambda function name                                                                                                              
Value               uptime-agent-singapore-production                                                                                                 

Key                 FunctionArn                                                                                                                       
Description         Lambda function ARN                                                                                                               
Value               arn:aws:lambda:ap-southeast-1:258975981113:function:uptime-agent-singapore-production                                             

Key                 ApiEndpoint                                                                                                                       
Description         API Gateway endpoint (use this for Route 53 CNAME)                                                                                
Value               https://peix9zg0u7.execute-api.ap-southeast-1.amazonaws.com                                                                       
-------------------------------------------------------------------------------------------------------------------------------------------------------


Successfully created/updated stack - uptime-agent-singapore in ap-southeast-1


CloudFormation outputs from deployed stack
-------------------------------------------------------------------------------------------------------------------------------------------------------
Outputs                                                                                                                                               
-------------------------------------------------------------------------------------------------------------------------------------------------------
Key                 FunctionName                                                                                                                      
Description         Lambda function name                                                                                                              
Value               uptime-agent-sydney-production                                                                                                    

Key                 FunctionArn                                                                                                                       
Description         Lambda function ARN                                                                                                               
Value               arn:aws:lambda:ap-southeast-2:258975981113:function:uptime-agent-sydney-production                                                

Key                 ApiEndpoint                                                                                                                       
Description         API Gateway endpoint (use this for Route 53 CNAME)                                                                                
Value               https://g0v6ixoz4c.execute-api.ap-southeast-2.amazonaws.com                                                                       
-------------------------------------------------------------------------------------------------------------------------------------------------------


Successfully created/updated stack - uptime-agent-sydney in ap-southeast-2


-------------------------------------------------------------------------------------------------------------------------------------------------------
##Delete Lambda Function 

winpty "/c/Program Files/Amazon/AWSSAMCLI/bin/sam.cmd" delete --stack-name uptime-agent-singapore --region ap-southeast-1