<?php
/**
 * @author Alexandre (DaazKu) Chouinard <alexandre.c@vanillaforums.com>
 * @copyright 2009-2018 Vanilla Forums Inc.
 * @license http://www.opensource.org/licenses/gpl-2.0.php GNU GPL v2
 */

use Garden\Web\RequestInterface;
use Vanilla\Models\SSOModel;
use Vanilla\Models\SSOData;

/**
 * Create /authenticate endpoint.
 */
class AuthenticateController extends Gdn_Controller {

    /**
     * @var AuthenticateApiController
     */
    private $authenticateApiController;

    /**
     * @var Gdn_Form
     */
    private $form;

    /**
     * @var RequestInterface
     */
    private $request;

    /**
     * @var SessionModel
     */
    private $sessionModel;

    /**
     * @var SSOModel
     */
    private $ssoModel;

    /**
     * @var UserModel
     */
    private $userModel;

    /**
     * AuthenticateController constructor.
     *
     * @param AuthenticateApiController $authenticateApiController
     * @param RequestInterface $request
     * @param SessionModel $sessionModel
     * @param SSOModel $ssoModel
     * @param UserModel $userModel
     */
    public function __construct(
        AuthenticateApiController $authenticateApiController,
        RequestInterface $request,
        SessionModel $sessionModel,
        SSOModel $ssoModel,
        UserModel $userModel
    ) {
        parent::__construct();

        $this->authenticateApiController = $authenticateApiController;
        $this->form = new Gdn_Form();
        $this->request = $request;
        $this->sessionModel = $sessionModel;
        $this->ssoModel = $ssoModel;
        $this->userModel = $userModel;
    }

    /**
     * Get the controller's form.
     *
     * @return Gdn_Form
     */
    public function getForm() {
        return $this->form;
    }

    /**
     * {@inheritdoc}
     */
    public function initialize() {
        Gdn::session()->ensureTransientKey();

        // Set up head
        $this->Head = new HeadModule($this);

        $this->addJsFile('jquery.js');
        $this->addJsFile('jquery.form.js');
        $this->addJsFile('jquery.popup.js');
        $this->addJsFile('jquery.popin.js');
        $this->addJsFile('jquery.gardenhandleajaxform.js');
        $this->addJsFile('jquery.atwho.js');
        $this->addJsFile('global.js');

        $this->addJsFile('authenticate.js');

        $this->addCssFile('style.css');
        $this->addCssFile('vanillicon.css', 'static');
        $this->addCssFile('authenticate.css');

        parent::initialize();
    }

    /**
     * Do an authentication using the specified authenticator.
     *
     * @param string $authenticatorType The authenticator's type.
     * @param string $authenticatorID The authenticator's instance ID.
     * @throws Exception Connect user feature is not implemented.
     */
    public function index($authenticatorType = '', $authenticatorID = '') {
        $persist = $this->request->getBody()['persist'] ?? ($this->request->getQuery()['persist'] ?? false);

        $response = $this->authenticateApiController->post([
            'authenticate' => [
                'authenticatorType' => $authenticatorType,
                'authenticatorID' => $authenticatorID,
            ],
            'persist' => $persist,
        ]);

        if ($response['authenticationStep'] === 'authenticated') {
            $redirectURL = (val('target', $this->request->getQuery(), '/'));
        } else {
            throw new Exception('Connect user feature is not implemented.', 500);
//            $target = val('target', $this->request->getQuery());
//            if ($target) {
//                $target = '&target='.$target;
//            }
//            $redirectURL = "/authenticate/connectuser?authSessionID={$response['authSessionID']}{$target}";
        }

        if ($this->deliveryMethod() === DELIVERY_METHOD_JSON) {
            $this->setRedirectTo($redirectURL);
        } else {
            redirectTo($redirectURL);
        }
    }

    /**
     *
     */
    public function recoverpassword() {
        $this->renderReact();
    }

    /**
     * Sign In Page
     */
    public function signin() {
        $this->renderReact();
    }

    /**
     * Password Page
     */
    public function password() {
        $this->renderReact();
    }
}
