import type {
  NextApiRequest,
  NextApiResponse,
} from "nextane/types";
import { sampleUserData } from "../../../utils/sample-data";

const handler = (_request: NextApiRequest, response: NextApiResponse) => {
  try {
    if (!Array.isArray(sampleUserData)) {
      throw new Error("Cannot find user data");
    }
    response.status(200).json(sampleUserData);
  } catch (error) {
    response.status(500).json({
      statusCode: 500,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

export default handler;
