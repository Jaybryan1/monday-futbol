// Deploy with JWT verification OFF: supabase functions deploy stripe-webhook --no-verify-jwt
// Security comes from mandatory Stripe signature verification.
import Stripe from 'npm:stripe@17.7.0';
import {createClient} from 'npm:@supabase/supabase-js@2';
Deno.serve(async req=>{
 if(req.method!=='POST')return new Response('Method not allowed',{status:405});
 const stripe=new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
 try{
  const body=await req.text();const signature=req.headers.get('stripe-signature');if(!signature)throw Error('Missing signature');
  const event=await stripe.webhooks.constructEventAsync(body,signature,Deno.env.get('STRIPE_WEBHOOK_SECRET')!);
  if(event.type==='checkout.session.completed'||event.type==='checkout.session.async_payment_succeeded'){
   const checkout=event.data.object as Stripe.Checkout.Session;
   if(checkout.payment_status!=='paid')return new Response('Payment not yet settled',{status:200});
   const id=checkout.metadata?.signup_id;if(!id||checkout.client_reference_id!==id)throw Error('Mismatched signup');
   const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
   // Capture same event once. If confirmation fails, the insert rolls back by explicit delete so Stripe retries work.
   const {error:insertError}=await db.from('payments').insert({stripe_session_id:checkout.id,signup_id:id});
   if(insertError){if(insertError.code==='23505')return new Response('Already processed',{status:200});throw insertError;}
   const {error}=await db.rpc('confirm_payment',{p_signup:id,p_method:'apple_pay'});
   if(error){await db.from('payments').delete().eq('stripe_session_id',checkout.id);throw error;}
  }
  return new Response('OK',{status:200});
 }catch(err){console.error(err);return new Response('Webhook rejected',{status:400});}
});
