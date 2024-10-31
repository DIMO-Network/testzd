import { createKernelAccount, createKernelAccountClient, createZeroDevPaymasterClient } from "@zerodev/sdk"
import { KERNEL_V3_1 } from "@zerodev/sdk/constants"
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator"
import { http, createPublicClient, zeroAddress, encodeFunctionData } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { polygonAmoy } from "viem/chains"
import { ENTRYPOINT_ADDRESS_V07, bundlerActions } from "permissionless"
import { toPermissionValidator } from "@zerodev/permissions"
import { toECDSASigner } from "@zerodev/permissions/signers"

import {
    CallPolicyVersion,
    ParamCondition,
    toCallPolicy,
    toGasPolicy,
    toRateLimitPolicy
} from "@zerodev/permissions/policies"

import {
    parseAbi,
    Hex,
} from "viem"

const PROJECT_ID = process.env.PROJECT_ID
const BUNDLER_RPC = `https://rpc.zerodev.app/api/v2/bundler/${PROJECT_ID}`
const PAYMASTER_RPC = `https://rpc.zerodev.app/api/v2/paymaster/${PROJECT_ID}`

const chain = polygonAmoy
const entryPoint = ENTRYPOINT_ADDRESS_V07
const kernelVersion = KERNEL_V3_1

const main = async () => {
    const sudoSigner = privateKeyToAccount(process.env.PRIVATE_KEY as Hex)

    console.log("Sudo signer adddress:", sudoSigner.address)

    const workerPrivateKey = generatePrivateKey()
    const workerSigner = privateKeyToAccount(workerPrivateKey)

    console.log("Worker signer adddress:", workerSigner.address)

    // Construct a public client
    const publicClient = createPublicClient({
        transport: http(BUNDLER_RPC),
        chain
    })

    const contractABI = parseAbi([
        "struct AttributeInfoPair { string attribute; string info; }",
        "function mintVehicleWithDeviceDefinition(uint256 manufacturerNode, address owner, string deviceDefinitionId, AttributeInfoPair[] attrInfo)",
    ])

    // Construct a validator
    const sudoEcdsaValidator = await signerToEcdsaValidator(publicClient, {
        signer: sudoSigner,
        entryPoint,
        kernelVersion
    })

    const workerEcdsaSigner = toECDSASigner({
        signer: workerSigner,
    })

    const workerValidator = await toPermissionValidator(publicClient, {
        entryPoint,
        kernelVersion: KERNEL_V3_1,
        signer: workerEcdsaSigner,
        policies: [
            toCallPolicy({
                policyVersion: CallPolicyVersion.V0_0_2,
                permissions: [
                    {
                        abi: contractABI,
                        target: "0x5eAA326fB2fc97fAcCe6A79A304876daD0F2e96c",
                        functionName: "mintVehicleWithDeviceDefinition",
                    }
                ]
            })
        ]
    })



    // Construct a Kernel account
    const account = await createKernelAccount(publicClient, {
        plugins: {
            sudo: sudoEcdsaValidator,
            regular: workerValidator,
        },
        entryPoint,
        kernelVersion
    })

    // Construct a Kernel account client
    const kernelClient = createKernelAccountClient({
        account,
        chain,
        entryPoint,
        bundlerTransport: http(BUNDLER_RPC),
        middleware: {
            sponsorUserOperation: async ({ userOperation }) => {
                const zerodevPaymaster = createZeroDevPaymasterClient({
                    chain,
                    entryPoint,
                    transport: http(PAYMASTER_RPC),
                })
                return zerodevPaymaster.sponsorUserOperation({
                    userOperation,
                    entryPoint,
                })
            },
        },
    })

    const accountAddress = kernelClient.account.address
    console.log("Account address:", accountAddress)

    // Donothing operation just to get the contract deployed.
    // const userOpHash = await kernelClient.sendUserOperation({
    //     userOperation: {
    //         callData: await kernelClient.account.encodeCallData({
    //             to: zeroAddress,
    //             value: BigInt(0),
    //             data: "0x",
    //         }),
    //     },
    // })

    // console.log("First UserOp hash:", userOpHash)

    const bundlerClient = kernelClient.extend(bundlerActions(entryPoint));
    // await bundlerClient.waitForUserOperationReceipt({
    //     hash: userOpHash,
    //     timeout: 1000 * 15,
    // })

    // console.log("View completed UserOp here: https://jiffyscan.xyz/userOpHash/" + userOpHash)

    // // Construct a Kernel account
    // const workerAccount = await createKernelAccount(publicClient, {
    //     plugins: {
    //         regular: workerValidator,
    //     },
    //     entryPoint,
    //     kernelVersion
    // })

    // // Construct a Kernel account client
    // const workerKernelClient = createKernelAccountClient({
    //     account: workerAccount,
    //     chain,
    //     entryPoint,
    //     bundlerTransport: http(BUNDLER_RPC),
    //     middleware: {
    //         sponsorUserOperation: async ({ userOperation }) => {
    //             const zerodevPaymaster = createZeroDevPaymasterClient({
    //                 chain,
    //                 entryPoint,
    //                 transport: http(PAYMASTER_RPC),
    //             })
    //             return zerodevPaymaster.sponsorUserOperation({
    //                 userOperation,
    //                 entryPoint,
    //             })
    //         },
    //     },
    // })

    // // Send a UserOp
    const mintOpHash = await kernelClient.sendUserOperation({
        userOperation: {
            // sender: kernelClient.account.address,
            callData: await kernelClient.account.encodeCallData({
                to: "0x5eAA326fB2fc97fAcCe6A79A304876daD0F2e96c",
                value: BigInt(0),
                data: encodeFunctionData({
                    abi: contractABI,
                    functionName: "mintVehicleWithDeviceDefinition",
                    args: [
                        BigInt(19),
                        "0xd744468B9192301650f8Cb5e390BdD824DFA6Dd9",
                        "cadillac_lyriq_2023",
                        [
                            {"attribute": "Make", "info": "Cadillac"},
                            {"attribute": "Model", "info": "Lyriq" },
                            { "attribute": "Year", "info": "2023" },
                        ],
                    ]
                }),
            }),
        },
    })

    console.log("UserOp hash:", mintOpHash)
    console.log("Waiting for UserOp to complete...")

    // const bundlerClient = kernelClient.extend(bundlerActions(entryPoint));
    await bundlerClient.waitForUserOperationReceipt({
        hash: mintOpHash,
        timeout: 1000 * 15,
    })

    console.log("View completed UserOp here: https://jiffyscan.xyz/userOpHash/" + mintOpHash)
}

main()
