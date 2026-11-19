import type { Metadata } from 'next';
import Storefront from '../../components/storefront';
export const metadata:Metadata={title:'Your Account — Wok & Chop',description:'Sign in, create a customer account, or continue as a guest.'};
export default function AccountPage(){return <Storefront page="account"/>}
