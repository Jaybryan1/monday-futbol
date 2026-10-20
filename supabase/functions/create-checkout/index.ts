// Deploy: supabase functions deploy create-checkout (JWT verification on)
import Stripe from 'npm:stripe@17.7.0';
import { createClient } from 'npm:@supabase/supabase-js@2';
const headers = { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS' };
Deno.serve(async req => {
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.method!=='POST')return Response.json({error:'Method not allowed'},{status:405,headers});
 try{
  const url=Deno.env.get('SUPABASE_URL')!, anon=Deno.env.get('SUPABASE_ANON_KEY')!, service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const token=req.headers.get('Authorization')?.replace(/^Bearer\s+/i,'');if(!token)throw Error('Missing login');
  const auth=createClient(url,anon);
  const {data:{user},error:authErr}=await auth.auth.getUser(token);if(authErr||!user)throw Error('Invalid login');
  const db=createClient(url,service);const {signup_id}=await req.json();
  const {data:signup,error}=await db.from('signups').select('id,user_id,week_monday,paid').eq('id',signup_id).single();
  if(error||!signup||signup.user_id!==user.id||signup.paid)throw Error('Invalid or already-paid signup');
  const {data:settings}=await db.from('site_settings').select('*').eq('id',1).single();
  if(!settings?.stripe_enabled)throw Error('Online payments are disabled');
  const origin=req.headers.get('origin')||Deno.env.get('SITE_URL');
  const siteUrl=Deno.env.get('SITE_URL')!; // e.g. https://username.github.io/monday-futbol/
  if(!siteUrl||!origin||new URL(origin).origin!==new URL(siteUrl).origin)throw Error('Unrecognized website origin');
  const stripe=new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
  const checkout=await stripe.checkout.sessions.create({mode:'payment',payment_method_types:['card'],
   line_items:[{price_data:{currency:settings.currency,product_data:{name:`Monday FC signup — week of ${signup.week_monday}`},unit_amount:settings.price_cents},quantity:1}],
   client_reference_id:signup.id,metadata:{signup_id:signup.id},
   success_url:siteUrl+(siteUrl.includes('?')?'&':'?')+'payment=success',cancel_url:siteUrl+(siteUrl.includes('?')?'&':'?')+'payment=cancel',
   expires_at:Math.floor(Date.now()/1000)+30*60});
  return Response.json({url:checkout.url},{headers});
 }catch(e){return Response.json({error:e.message||'Checkout error'},{status:400,headers})}
});
